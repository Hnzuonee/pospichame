const ctaButton = document.getElementById('cta');
const msgElement = document.getElementById('msg');
let widgetId = null;

// TOTO JE SITE KEY PRO INVISIBLE MÓD
const SITE_KEY = '0x4AAAAAAB3aoUBtDi_jhPAf'; 

// ==========================================================
// FUNKCE PRO DETEKCI INSTAGRAM WEBVIEW
// ==========================================================
/**
 * Kontroluje User Agent, zda se jedná o Instagram Webview.
 * @returns {boolean} True, pokud je detekováno Instagram Webview.
 */
const isInstagramWebview = () => {
    // Získání User Agent v malých písmenech
    const userAgent = navigator.userAgent.toLowerCase();

    // 1. Zkontrolujeme, zda se jedná o aplikaci Meta/Instagram
    const isMetaApp = userAgent.includes('instagram') || userAgent.includes('fbav');

    // 2. Zkontrolujeme, zda se jedná o Webview
    // 'wv' - Indikátor Android Webview
    // Na iOS (kde Webview používá Safari engine) Instagram odstraňuje 'safari'
    const isNativeWebview = userAgent.includes('wv') || (!userAgent.includes('safari') && userAgent.includes('mobile'));

    // Kombinace: je to aplikace Meta A zároveň to nevypadá jako standardní prohlížeč
    return isMetaApp && isNativeWebview;
};

// ==========================================================
// OKAMŽITÁ KONTROLA A BLOKOVÁNÍ PŘÍSTUPU
// ==========================================================
if (isInstagramWebview()) {
    const blockMessage = '⚠️ Prosím, otevřete tuto stránku v externím prohlížeči (např. Chrome, Safari). Instagram Webview není podporován z bezpečnostních důvodů.';
    
    // Zablokuje tlačítko a zobrazí zprávu, pokud elementy existují
    if (ctaButton) {
        ctaButton.disabled = true;
        ctaButton.textContent = "Zablokováno";
    }
    if (msgElement) {
        msgElement.textContent = blockMessage;
        msgElement.style.color = 'red'; // Pro lepší viditelnost varování
    }
    
    // Zastaví veškeré další vykonávání skriptu, včetně Turnstile
    throw new Error('Přístup blokován v Instagram Webview.'); 
}
// ==========================================================


/**
 * Nastaví zprávu, text tlačítka a stav zakázání.
 */
const setStatus = (message = '', buttonText = null, disableButton = false) => {
    msgElement.textContent = message;
    ctaButton.disabled = disableButton;
    if (buttonText) {
        ctaButton.textContent = buttonText;
    }
};

/**
 * Zpracuje chybu, zobrazí zprávu a resetuje Turnstile.
 * Při neviditelném módu se volá i po chybě serveru, aby se mohl znovu spustit.
 * @param {string} message - Chybová zpráva.
 */
const handleError = (message) => {
    setStatus(message, 'Zkusit znovu', false);
    try {
        if (widgetId && window.turnstile) {
            // Widget resetujeme, aby se mohl znovu spustit po kliknutí
            turnstile.reset(widgetId);
            console.log('Turnstile widget resetován po chybě.');
        }
    } catch (e) {
        console.error('Failed to reset Turnstile widget:', e);
    }
};

/**
 * Spustí se po úspěšném ověření tokenu (callback).
 * @param {string} token - Turnstile ověřovací token.
 */
window.onTurnstileSuccess = async (token) => {
    if (!token) {
        return handleError('Ověření selhalo, zkuste to prosím znovu.');
    }
    setStatus('Ověřeno, připravuji vstup…', 'Moment…', true);

    try {
        const response = await fetch('/v', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ t: token }),
        });

        if (!response.ok) {
            let errorMessage = `Server chyba (${response.status})`;
            try { 
                const errorData = await response.json(); 
                if (errorData?.error) {
                    errorMessage = `Server: ${errorData.error}`;
                }
            } catch (e) {
                // Ignore: server nevrátil JSON
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        const ticket = data?.k || data?.ticket;

        if (!ticket) {
            throw new Error('Chybí vstupenka (ticket), zkuste to prosím znovu.');
        }
        
        window.location.href = `/g?ticket=${encodeURIComponent(ticket)}`;

    } catch (e) {
        handleError(e.message || 'Síťová chyba. Zkuste to prosím znovu.');
    }
};

/**
 * Spustí se při chybě (error-callback) nebo vypršení platnosti (timeout-callback)
 */
window.onTurnstileError = () => handleError('Chyba ověření. Zkuste to prosím znovu.');

/**
 * Tato funkce se zavolá, jakmile je Turnstile API načteno
 */
window.turnstileReady = () => {
    // POZOR: Tato funkce se NESPUSTÍ, pokud předchozí blok 'if (isInstagramWebview())' vyvolá chybu.
    try {
        // Kritické pro NEVIDITELNÝ MÓD: 
        widgetId = turnstile.render('#turnstile-container', {
            sitekey: SITE_KEY,
            callback: window.onTurnstileSuccess,
            'error-callback': window.onTurnstileError,
            'timeout-callback': window.onTurnstileError,
            execution: 'execute', // Nespustí se automaticky
            theme: 'dark', 
            size: 'normal',
        });
        
        // Nastavíme, že je připraveno kliknout
        setStatus('', 'Vstoupit ❤️', false);
        console.log("Neviditelný Turnstile vykreslen a připraven k execute.");
    } catch (e) {
        console.error('Turnstile render failed:', e);
        handleError('Nepodařilo se načíst ověření. Zkuste obnovit stránku.');
    }
};

// Spuštění ověření po kliknutí na tlačítko
ctaButton.addEventListener('click', () => {
    if (ctaButton.disabled) return;
    
    if (widgetId && window.turnstile) {
        setStatus('Ověřuji…', 'Ověřuji…', true);
        // Ruční spuštění ověření
        turnstile.execute(widgetId);
    } else {
        handleError('Ověření není připraveno. Zkuste obnovit stránku.');
    }
});
