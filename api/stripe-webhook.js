const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');

// Disables default Vercel bodyParser so we can read the raw body signature
module.exports.config = {
    api: {
        bodyParser: false,
    },
};

const getRawBody = async (readable) => {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
};

const hash = (val) => {
    if (!val) return undefined;
    const clean = val.toString().toLowerCase().trim();
    return crypto.createHash('sha256').update(clean).digest('hex');
};

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        const rawBody = await getRawBody(req);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
        console.error('[Stripe Webhook Error]:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata || {};

        console.log(`[Stripe Webhook] Payment received for Session ${session.id}. Logging order...`);

        // Normalise Phone for Meta CAPI (ensure E.164 format)
        let phoneVal = meta.phone || '';
        let metaPhone = undefined;
        if (phoneVal) {
            let ph = phoneVal.replace(/\D/g, '');
            if (ph.startsWith('0')) {
                ph = '971' + ph.substring(1); // default to UAE code if 0-prefixed in GCC
            }
            metaPhone = ph;
        }

        const tasks = [];

        // 1. Google Sheets Log (via Lead Webhook receiver)
        const SHEETS_WEBHOOK = process.env.LEADS_SHEET_WEBHOOK || 'https://script.google.com/macros/s/AKfycbynwAaZLJrmDy2FZnuYf9wWqnQtMMm6CpTQdVDIi69gnP0mSpR0yz9QFGLUyYlwCJF2/exec';
        if (SHEETS_WEBHOOK) {
            const sheetData = {
                "Conversion Time": new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }) + ' (GST)',
                "Name": meta.name || 'N/A',
                "Phone": phoneVal || 'N/A',
                "Email": meta.email || session.customer_email || 'N/A',
                "Event ID": session.id, // Stripe checkout session ID is unique
                "City": meta.city || 'N/A',
                "URL": `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/checkout`,
                "fbc": meta.fbc || '',
                "fbp": meta.fbp || '',
                "IP": meta.client_ip || '',
                "UA": meta.user_agent || '',
                "Google Click ID": meta.gclid || '',
                "ttclid": '',
                "Traffic Type": meta.traffic_type || 'paid',
                "Value": parseFloat(meta.total_value || 50),
                "Upsell Selected": meta.upsell_selected || 'No',
                "Payment Method": 'Stripe Card/ApplePay',
                "Status": 'Paid'
            };

            tasks.push(
                fetch(SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sheetData)
                }).then(r => r.text()).catch(e => ({ error: 'Sheets Failed', msg: e.message }))
            );
        }

        // 2. Meta Conversions API (CAPI) Purchase Event
        const META_PIXEL_ID = process.env.META_PIXEL_ID || '1622955485439618';
        const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
        
        if (META_ACCESS_TOKEN) {
            const metaPayload = {
                data: [{
                    event_name: 'Purchase',
                    event_time: Math.floor(Date.now() / 1000),
                    event_id: session.id, // Deduplicator event ID
                    event_source_url: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/checkout`,
                    action_source: 'website',
                    user_data: {
                        client_ip_address: meta.client_ip || null,
                        client_user_agent: meta.user_agent || null,
                        ph: hash(metaPhone),
                        em: hash(meta.email || session.customer_email),
                        fn: hash(meta.name),
                        ct: hash(meta.city),
                        external_id: hash(metaPhone),
                        fbc: meta.fbc || null,
                        fbp: meta.fbp || null
                    },
                    custom_data: {
                        currency: 'AED',
                        value: parseFloat(meta.total_value || 50),
                        content_name: meta.offers || 'AI Video Bootcamp'
                    }
                }]
            };

            tasks.push(
                fetch(`https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(metaPayload)
                }).then(r => r.json()).catch(e => ({ error: 'Meta Failed', msg: e.message }))
            );
        }

        try {
            const results = await Promise.all(tasks);
            console.log('[Stripe Webhook Success] Logged tasks:', results);
            return res.status(200).json({ success: true, logged: true, results: results });
        } catch (error) {
            console.error('[Stripe Webhook Processing Error]:', error);
            return res.status(500).json({ error: 'Failed logging purchase', details: error.message });
        }
    }

    return res.status(200).json({ received: true });
};
