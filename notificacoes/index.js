const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE = 'fila_notificacoes';

// Controle simples de idempotência em memória para evitar envio duplicado de e-mails
const pedidosProcessados = new Set();

async function iniciarConsumidor() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertQueue(QUEUE, { durable: true });
        console.log(`[Notificações] Aguardando mensagens na fila '${QUEUE}'...`);

        channel.consume(QUEUE, (msg) => {
            if (msg !== null) {
                const conteudo = JSON.parse(msg.content.toString());
                
                if (conteudo.evento === 'pedido_criado') {
                    const id = conteudo.dados.pedidoId;

                    // Verifica IDEMPOTÊNCIA (evita processar a mesma mensagem duas vezes)
                    if (pedidosProcessados.has(id)) {
                        console.log(`[Notificações] Ignorado: Pedido #${id} já havia sido notificado.`);
                    } else {
                        pedidosProcessados.add(id);
                        console.log(`[Notificações] SUCESSO! Enviando e-mail para o cliente: Seu pedido #${id} do produto '${conteudo.dados.produto}' foi confirmado.`);
                    }
                }

                // Confirma o recebimento da mensagem ao RabbitMQ (ACK)
                channel.ack(msg);
            }
        });
    } catch (error) {
        console.error(`[Notificações] Erro ao conectar no RabbitMQ: ${error.message}. Tentando novamente em 5s...`);
        // Retry básico se o RabbitMQ demorar a subir no Docker
        setTimeout(iniciarConsumidor, 5000);
    }
}

iniciarConsumidor();