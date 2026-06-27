// Global error tracker to catch hidden issues
window.addEventListener('error', function (e) {
    console.error('❌ [CAPIBridge] Global Error:', e.message, 'at', e.filename, 'line', e.lineno);
});

function onReady(fn) {
    console.log('[CAPIBridge] onReady check. State:', document.readyState);
    if (document.readyState !== 'loading') {
        console.log('[CAPIBridge] onReady executing immediately');
        fn();
    } else {
        console.log('[CAPIBridge] onReady waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', function () {
            console.log('[CAPIBridge] onReady DOMContentLoaded fired');
            fn();
        });
    }
}

console.log('🚀 [CAPIBridge] Script initialized');

window.CAPIBridge = (function () {
    // Configuration

    function generateEventId() {
        return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // ─── FBC / FBP ATTRIBUTION ───────────────────────────────────────────────
    // Reads fbclid from URL and formats it as the Meta fbc parameter.
    // Stored in localStorage so it survives navigation between pages.
    function captureFbc() {
        const params = new URLSearchParams(window.location.search);
        const fbclid = params.get('fbclid');
        if (fbclid) {
            const fbc = 'fb.1.' + Date.now() + '.' + fbclid;
            localStorage.setItem('meta_fbc', fbc);
            console.log('[CAPIBridge] ✅ fbc captured and stored:', fbc);
            return fbc;
        }
        return localStorage.getItem('meta_fbc') || null;
    }

    // Reads the _fbp cookie set automatically by the Meta Pixel.
    function getFbp() {
        const match = document.cookie.match(/(^|;)\s*_fbp=([^;]+)/);
        const fbp = match ? match[2] : null;
        if (fbp) localStorage.setItem('meta_fbp', fbp);
        return fbp || localStorage.getItem('meta_fbp') || null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── GCLID ATTRIBUTION ────────────────────────────────────────────────────
    // Reads gclid from URL and stores it. Used for Google Ads Enhanced Conversions.
    function captureGclid() {
        const params = new URLSearchParams(window.location.search);
        const gclid = params.get('gclid');
        if (gclid) {
            localStorage.setItem('google_click_id', gclid);
            console.log('[CAPIBridge] ✅ gclid captured and stored:', gclid);
            return gclid;
        }
        return localStorage.getItem('google_click_id') || null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── TTCLID ATTRIBUTION (TikTok) ──────────────────────────────────────────
    // Reads ttclid from URL and stores it. Used for TikTok Events API.
    function captureTtclid() {
        const params = new URLSearchParams(window.location.search);
        const ttclid = params.get('ttclid');
        if (ttclid) {
            localStorage.setItem('tiktok_click_id', ttclid);
            console.log('[CAPIBridge] ✅ ttclid captured and stored:', ttclid);
            return ttclid;
        }
        return localStorage.getItem('tiktok_click_id') || null;
    }
    // ─────────────────────────────────────────────────────────────────────────

    function isAdTraffic() {
        const params = new URLSearchParams(window.location.search);
        const hasParams = params.has('fbclid') || params.has('utm_source') || params.has('utm_medium') || params.has('gclid') || params.has('ttclid');

        if (hasParams) {
            localStorage.setItem('is_paid_traffic', 'true');
            return true;
        }

        return localStorage.getItem('is_paid_traffic') === 'true';
    }

    // Run attribution captures immediately on script load
    captureFbc();
    captureGclid();
    captureTtclid();

    function track(eventName, standardParams = {}, customParams = {}, userData = {}, overrideEventId = null) {
        // Event ID Locking: Reuse the same ID for the same event type in a session
        // This ensures Meta deduplicates accidental double-clicks or refreshes.
        const sessionKey = `meta_eid_${eventName.toLowerCase()}`;
        let eventId = overrideEventId || sessionStorage.getItem(sessionKey);
        let isNewEvent = false;

        if (!eventId) {
            eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem(sessionKey, eventId);
            isNewEvent = true;
            console.log(`[CAPIBridge] Generated NEW ID for ${eventName}: ${eventId}`);
        } else {
            if (overrideEventId) {
                isNewEvent = true; // Always fire if explicitly overridden (e.g. Purchase session ID)
                console.log(`[CAPIBridge] Using OVERRIDDEN ID for ${eventName}: ${eventId}`);
            } else {
                console.log(`[CAPIBridge] Reusing LOCKED ID for ${eventName}: ${eventId} (browser pixel skipped)`);
            }
        }

        const trafficType = isAdTraffic() ? 'paid' : 'organic';

        console.log(`[CAPIBridge] Tracking ${eventName}`, { eventId, isNewEvent, standardParams, customParams, userData });

        // 1. Browser Pixel — only fire if this is the FIRST time this event fires in this session
        // Prevents duplicate pixel warnings while server CAPI handles deduplication
        if (window.fbq && isNewEvent) {
            const pixelParams = { ...standardParams, ...customParams };
            fbq('track', eventName, pixelParams, { eventID: eventId });
        } else if (!window.fbq) {
            console.warn('[CAPIBridge] Meta Pixel (fbq) not found');
        }

        // 1.1 TikTok Browser Pixel
        if (window.ttq && isNewEvent) {
            const ttEventMap = {
                'Purchase': 'CompletePayment',
                'Lead': 'SubmitForm',
                'InitiateCheckout': 'InitiateCheckout',
                'PageView': 'PageView'
            };
            const ttEventName = ttEventMap[eventName] || eventName;
            ttq.track(ttEventName, {
                ...standardParams,
                ...customParams
            }, { event_id: eventId });
            console.log(`[CAPIBridge] TikTok Browser Pixel: ${ttEventName}`);
        }

        // 2. Server CAPI (Rich Data)
        // Map user data to Meta standard keys
        const mappedUserData = {};
        if (userData.phone) mappedUserData.ph = userData.phone.replace(/\D/g, '');
        if (userData.email) mappedUserData.em = userData.email.toLowerCase().trim();
        if (userData.external_id) mappedUserData.external_id = userData.external_id;
        if (userData.fn) mappedUserData.fn = userData.fn.toLowerCase().trim();

        // Attach fbc and fbp for Meta attribution
        const fbc = captureFbc();
        const fbp = getFbp();
        if (fbc) mappedUserData.fbc = fbc;
        if (fbp) mappedUserData.fbp = fbp;

        // Attach gclid for Google Ads attribution
        const gclid = captureGclid();
        // Attach ttclid for TikTok attribution
        const ttclid = captureTtclid();

        const payload = {
            event_name: eventName,
            event_id: eventId,
            event_source_url: window.location.href,
            user_data: {
                ...mappedUserData,
                ttclid: ttclid
            },
            custom_data: {
                ...standardParams,
                ...customParams,
                traffic_type: trafficType
            },
            gclid: gclid || ''
        };

        fetch('/api/capi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify(payload)
        })
            .then(async r => {
                const data = await r.json();
                if (r.ok) {
                    console.log(`[CAPIBridge] ✅ ${eventName} tracked successfully:`, data);
                } else {
                    console.error(`[CAPIBridge] ❌ ${eventName} server error:`, data);
                }
            })
            .catch(err => {
                console.error(`[CAPIBridge] ❌ ${eventName} network error:`, err);
            });
    }

    return {
        pageView: function () { track('PageView'); },
        viewContent: function () {
            track('ViewContent', {
                content_name: 'AI Video Bootcamp',
                content_category: 'Online Course',
                content_ids: ['avb_001'],
                content_type: 'product',
                value: 1999,
                currency: 'PKR'
            });
        },
        lead: function (customParams = {}, userData = {}) {
            // Support both formats to be safe
            const normalizedUserData = { ...userData };
            if (!normalizedUserData.fn && normalizedUserData.name) normalizedUserData.fn = normalizedUserData.name;
            if (!normalizedUserData.phone && normalizedUserData.ph) normalizedUserData.phone = normalizedUserData.ph;

            track('Lead', {
                content_name: 'AI Video Bootcamp',
                content_category: 'Online Course',
                currency: 'PKR',
                value: 1999
            }, customParams, normalizedUserData);
        },
        initiateCheckout: function () {
            track('InitiateCheckout', {
                content_name: 'AI Video Bootcamp',
                content_ids: ['avb_001'],
                content_type: 'product',
                currency: 'PKR',
                value: 1999
            });
        },
        purchase: function (value = 50, currency = 'AED', transactionId = null, method = 'stripe') {
            track('Purchase', {
                content_name: 'AI Video Bootcamp',
                content_category: 'Online Course',
                content_ids: ['avb_001'],
                content_type: 'product',
                currency: currency,
                value: parseFloat(value)
            }, {
                payment_method: method
            }, {}, transactionId);
        }
    };
})();
