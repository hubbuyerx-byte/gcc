const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    // Health Check
    if (req.method === 'GET') {
        return res.status(200).json({ status: 'online', time: new Date().toISOString() });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, phone, city, hasBump, hasMarketian, gclid, fbc, fbp, traffic_type, lang } = req.body;

    if (!name || !email || !phone) {
        return res.status(400).json({ error: 'Missing required customer details (name, email, phone)' });
    }

    try {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        // 1. Build Stripe Line Items (Prices in AED Cents/Fils)
        const lineItems = [
            {
                price_data: {
                    currency: 'aed',
                    product_data: {
                        name: 'AI Video Bootcamp',
                        description: 'Learn AI Video Creation and Build a Creative Business',
                    },
                    unit_amount: 4900, // 49.00 AED
                },
                quantity: 1,
            }
        ];

        let offersList = ['AI Video Bootcamp'];
        let totalValue = 49;

        if (hasBump) {
            lineItems.push({
                price_data: {
                    currency: 'aed',
                    product_data: {
                        name: "AI Creator's Cheat Code Vault",
                        description: '50+ prompts, characters, and templates extension',
                    },
                    unit_amount: 1900, // 19.00 AED
                },
                quantity: 1,
            });
            offersList.push("AI Creator's Vault");
            totalValue += 19;
        }

        const client_ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const user_agent = req.headers['user-agent'] || '';

        const successPage = lang === 'ar' ? 'success-ar' : 'success';
        const cancelPage = lang === 'ar' ? 'checkout-ar' : 'checkout';

        // 2. Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: email,
            line_items: lineItems,
            success_url: `${baseUrl}/${successPage}?session_id={CHECKOUT_SESSION_ID}&val=${totalValue}`,
            cancel_url: `${baseUrl}/${cancelPage}`,
            metadata: {
                name: name,
                phone: phone,
                city: city || 'Not specified',
                email: email,
                offers: offersList.join(' + '),
                total_value: totalValue.toString(),
                gclid: gclid || '',
                fbc: fbc || '',
                fbp: fbp || '',
                traffic_type: traffic_type || 'paid',
                client_ip: client_ip,
                user_agent: user_agent,
                upsell_selected: hasBump ? 'Yes' : 'No'
            }
        });

        return res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('[Stripe Checkout Session Error]:', error);
        return res.status(500).json({ error: 'Stripe integration failed', message: error.message });
    }
};
