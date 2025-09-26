// Globální proměnné pro stav
const ctaButton = document.getElementById('cta');
const msgElement = document.getElementById('msg');
let isProcessing = false;
let widgetId = null; // Budeme ukládat ID widgetu

// Funkce pro nastavení stavové zprávy a tlačítka
const setStatus = (message = '', buttonText = null, busy = false) => {
  msgElement.textContent = message;
  isProcessing = busy;
  ctaButton.disabled = busy;
  if (buttonText) {
    ctaButton.textContent = buttonText;
  }
};

// Funkce pro zpracování chyb
const handleError = (message) => {
  setStatus(message, 'Zkusit znovu', false);
  try {
    if (widgetId && window.turnstile) {
      turnstile.reset(widgetId);
    }
  } catch (e) {
    console.error('Failed to reset Turnstile widget:', e);
  }
};

// Callback, který se zavolá po úspěšném ověření Turnstile
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
      let errorData = null;
      try {
        errorData = await response.json();
      } catch {}
      const errorMessage = errorData?.error ? `Server: ${errorData.error}` : `Server chyba (${response.status})`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const ticket = data?.k || data?.ticket;

    if (!ticket) {
      throw new Error('Chybí vstupenka, zkuste to prosím znovu.');
    }
    
    // Vše OK, přesměrování
    window.location.href = `/g?ticket=${encodeURIComponent(ticket)}`;

  } catch (e) {
    handleError(e.message || 'Síťová chyba. Zkuste to prosím znovu.');
  }
};

// Callback pro chyby a timeout Turnstile
window.onTurnstileError = () => handleError('Chyba ověření. Zkuste to prosím znovu.');

// Tato funkce se zavolá, jakmile je externí skript Turnstile načtený a připravený
window.turnstileReady = () => {
  const turnstileOptions = {
    sitekey: '0x4AAAAAAB3aoUBtDi_jhPAf',
    callback: window.onTurnstileSuccess,
    'error-callback': window.onTurnstileError,
    'timeout-callback': window.onTurnstileError,
    // ----> TATO ZMĚNA VŠE OPRAVÍ <----
    execution: 'execute', 
  };

  try {
    // Vykreslíme neviditelný widget a uložíme si jeho ID
    widgetId = turnstile.render('body', { ...turnstileOptions, theme: 'dark', size: 'invisible' });
    setStatus('', 'Pokračovat na osobní stránku (18+)', false);
  } catch (e) {
    console.error('Turnstile render failed:', e);
    handleError('Nepodařilo se načíst ověření.');
  }
};

// Při kliknutí na tlačítko spustíme ověření
ctaButton.addEventListener('click', () => {
  if (isProcessing) return;
  
  if (widgetId && window.turnstile) {
    setStatus('Ověřuji…', 'Ověřuji…', true);
    turnstile.execute(widgetId);
  } else {
    handleError('Ověření není připraveno. Zkuste obnovit stránku.');
  }
});
