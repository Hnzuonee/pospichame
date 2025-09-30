const ctaButton = document.getElementById('cta');
const msgElement = document.getElementById('msg');
let widgetId = null;

// TOTO JE SITE KEY PRO INVISIBLE MÓD
const SITE_KEY = '0x4AAAAAAB3aoUBtDi_jhPAf'; 

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
    try {
        // Kritické pro NEVIDITELNÝ MÓD: 
        // 1. Zde se vykreslí NEVIDITELNÝ WIDGET do kontejneru.
        // 2. 'execution: execute' zajistí, že se nespustí automaticky.
        widgetId = turnstile.render('#turnstile-container', {
            sitekey: SITE_KEY,
            callback: window.onTurnstileSuccess,
            'error-callback': window.onTurnstileError,
            'timeout-callback': window.onTurnstileError,
            execution: 'execute', 
            theme: 'dark', // Téma už nehraje roli, widget je neviditelný
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

// Spuštění ověření po kliknutí na tlačítko (ctaButton je v DOM)
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