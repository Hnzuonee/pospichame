const ctaButton = document.getElementById('cta');
const msgElement = document.getElementById('msg');
let isProcessing = false;
let widgetId = null;

const setStatus = (message = '', buttonText = null, busy = false) => {
  msgElement.textContent = message;
  isProcessing = busy;
  ctaButton.disabled = busy;
  if (buttonText) {
    ctaButton.textContent = buttonText;
  }
};

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
      try { errorData = await response.json(); } catch {}
      const errorMessage = errorData?.error ? `Server: ${errorData.error}` : `Server chyba (${response.status})`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const ticket = data?.k || data?.ticket;

    if (!ticket) {
      throw new Error('Chybí vstupenka, zkuste to prosím znovu.');
    }
    
    window.location.href = `/g?ticket=${encodeURIComponent(ticket)}`;

  } catch (e) {
    handleError(e.message || 'Síťová chyba. Zkuste to prosím znovu.');
  }
};

window.onTurnstileError = () => handleError('Chyba ověření. Zkuste to prosím znovu.');

window.turnstileReady = () => {
  try {
    widgetId = turnstile.render('#turnstile-container', {
      sitekey: '0x4AAAAAAB3aoUBtDi_jhPAf',
      callback: window.onTurnstileSuccess,
      'error-callback': window.onTurnstileError,
      'timeout-callback': window.onTurnstileError,
      execution: 'execute',
      theme: 'dark',
      size: 'invisible',
    });
    setStatus('', 'Vstoupit ❤️', false);
  } catch (e) {
    console.error('Turnstile render failed:', e);
    handleError('Nepodařilo se načíst ověření.');
  }
};

ctaButton.addEventListener('click', () => {
  if (isProcessing) return;
  
  if (widgetId && window.turnstile) {
    setStatus('Ověřuji…', 'Ověřuji…', true);
    turnstile.execute(widgetId);
  } else {
    handleError('Ověření není připraveno. Zkuste obnovit stránku.');
  }
});
