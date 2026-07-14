const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

// Conexão com o banco isolado de Pedidos
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'pedidos',
    port: 5432,
});

// Criação automática da tabela caso não exista
pool.query(`
    CREATE TABLE IF NOT EXISTS compras (
        id SERIAL PRIMARY KEY,
        produto VARCHAR(100) NOT NULL,
        quantidade INT NOT NULL,
        reserva_id VARCHAR(100) NOT NULL
    )
`).catch(err => console.error("Erro ao criar tabela:", err));

// Função para publicar evento no RabbitMQ
async function publicarEvento(evento, payload) {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'fila_notificacoes';

        await channel.assertQueue(queue, { durable: true });
        
        const mensagem = JSON.stringify({ evento, dados: payload });
        channel.sendToQueue(queue, Buffer.from(mensagem), { persistent: true });
        
        console.log(`[Pedidos] Evento '${evento}' enviado para a fila.`);
        
        setTimeout(() => {
            connection.close();
        }, 500);
    } catch (error) {
        console.error(`[Pedidos] Erro ao conectar no RabbitMQ: ${error.message}`);
    }
}

app.post('/criar', async (req, res) => {
    const { produto, quantidade, reservaId } = req.body;

    try {
        console.log(`[Pedidos] Gravando pedido do produto ${produto}...`);
        
        // Grava no banco de dados próprio
        const result = await pool.query(
            'INSERT INTO compras (produto, quantidade, reserva_id) VALUES ($1, $2, $3) RETURNING id',
            [produto, quantidade, reservaId]
        );
        const pedidoId = result.rows[0].id;

        // Comunicação Indireta: Publica o evento pedido_criado
        await publicarEvento('pedido_criado', {
            pedidoId,
            produto,
            quantidade,
            reservaId
        });

        return res.status(201).json({ pedidoId, status: "CONCLUIDO" });
    } catch (error) {
        console.error(`[Pedidos] Erro ao gravar pedido: ${error.message}`);
        return res.status(500).json({ erro: "Falha ao processar o pedido." });
    }
});

app.listen(PORT, () => {
    console.log(`Serviço de Pedidos operando na porta ${PORT}`);
});