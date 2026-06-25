const crypto = require('crypto');

module.exports = async (req, res) => {
    // 0. Health Check
    if (req.method === 'GET') {
        return res.status(200).json({ status: 'online', time: new Date().toISOString() });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { event_name, event_id, event_source_url, user_data = {}, custom_data = {} } = req.body;
    
    // Config
    const META_PIXEL_ID = process.env.META_PIXEL_ID || '1622955485439618';
    const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    const SHEETS_WEBHOOK = process.env.LEADS_SHEET_WEBHOOK || 'https://script.google.com/macros/s/AKfycbynwAaZLJrmDy2FZnuYf9wWqnQtMMm6CpTQdVDIi69gnP0mSpR0yz9QFGLUyYlwCJF2/exec';
    
    // Helper: SHA256 hashing
    const hash = (val) => {
        if (!val) return undefined;
        const clean = val.toString().toLowerCase().trim();
        return crypto.createHash('sha256').update(clean).digest('hex');
    };

    const client_ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const user_agent = req.headers['user-agent'];
    const city = custom_data.city || user_data.ct || user_data.city;

    // Normalize phone to GCC E.164 format (e.g. 971XXXXXXXXX) before hashing for Meta CAPI
    let metaPhone = undefined;
    if (user_data.ph || user_data.phone) {
        const rawPhone = user_data.ph || user_data.phone;
        let ph = rawPhone.toString().replace(/\D/g, '');
        if (ph.startsWith('0')) {
            ph = '971' + ph.substring(1);
        }
        metaPhone = ph;
    }

    const totalValue = parseFloat(custom_data.value || 50);

    // ─── META CAPI PAYLOAD ──────────────────────────────────────────────────
    const metaPayload = {
        data: [{
            event_name: event_name,
            event_time: Math.floor(Date.now() / 1000),
            event_id: event_id,
            event_source_url: event_source_url,
            action_source: 'website',
            user_data: {
                client_ip_address: client_ip,
                client_user_agent: user_agent,
                ph: hash(metaPhone),
                em: hash(user_data.em || user_data.email),
                fn: hash(user_data.fn || user_data.name),
                ct: hash(city),
                external_id: hash(metaPhone),
                fbc: user_data.fbc || null,
                fbp: user_data.fbp || null
            },
            custom_data: {
                currency: 'AED',
                value: totalValue,
                content_name: custom_data.content_name || 'AI Video Bootcamp'
            }
        }]
    };

    const tasks = [];

    // Task 1: Meta CAPI
    if (META_ACCESS_TOKEN) {
        tasks.push(
            fetch(`https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metaPayload)
            }).then(r => r.json()).catch(e => ({ error: 'Meta Failed', msg: e.message }))
        );
    }

    // Task 2: Google Sheets (Log Lead)
    if (event_name === 'Lead' && SHEETS_WEBHOOK) {
        const dataToSubmit = {
            "Conversion Time": new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }) + ' (GST)',
            "Name": user_data.fn || user_data.name || custom_data.name || 'N/A',
            "Phone": user_data.ph || user_data.phone || custom_data.phone || 'N/A',
            "Email": user_data.em || user_data.email || 'N/A',
            "Event ID": event_id || 'N/A',
            "City": city || 'N/A',
            "URL": event_source_url || 'N/A',
            "fbc": user_data.fbc || '',
            "fbp": user_data.fbp || '',
            "IP": client_ip || '',
            "UA": user_agent || '',
            "Google Click ID": req.body.gclid || custom_data.gclid || '',
            "ttclid": user_data.ttclid || '',
            "Traffic Type": custom_data.traffic_type || 'paid',
            "Value": totalValue,
            "Upsell Selected": (totalValue > 50) ? 'Yes' : 'No',
            "Payment Method": 'Pending Stripe',
            "Status": 'Unpaid'
        };
        
        tasks.push(
            fetch(SHEETS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSubmit)
            }).then(r => r.text()).catch(e => ({ error: 'Sheets Failed', msg: e.message }))
        );
    }

    try {
        const results = await Promise.all(tasks);
        return res.status(200).json({ success: true, event_id: event_id, results: results });
    } catch (error) {
        return res.status(500).json({ error: 'Processing Failed', details: error.message });
    }
};
