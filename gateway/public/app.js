const form = document.querySelector('#order-form');
const quantity = document.querySelector('#quantity');
const feedback = document.querySelector('#feedback');
const submitButton = form.querySelector('button[type="submit"]');

function updateQuantity(change) {
  const current = Number.parseInt(quantity.value, 10) || 1;
  quantity.value = Math.min(99, Math.max(1, current + change));
}

document.querySelector('#decrease').addEventListener('click', () => updateQuantity(-1));
document.querySelector('#increase').addEventListener('click', () => updateQuantity(1));

function showFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
  feedback.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  feedback.hidden = true;

  const quantidade = Number.parseInt(quantity.value, 10);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    showFeedback('Informe uma quantidade válida, maior que zero.', 'error');
    quantity.focus();
    return;
  }

  const originalLabel = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.textContent = 'Processando o fluxo…';

  try {
    const response = await fetch('/pedido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        produto: document.querySelector('#product').value,
        quantidade
      })
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.erro || 'Não foi possível processar o pedido.');

    const id = data.pedido?.pedidoId;
    showFeedback(`Pedido #${id} concluído com sucesso. A notificação será processada em seguida.`, 'success');
    quantity.value = 1;
  } catch (error) {
    showFeedback(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalLabel;
  }
});
