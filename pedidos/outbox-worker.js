const { Pool } = require('pg');
const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE = 'fila_notificacoes';
const INTERVALO_MS = Number(process.env.OUTBOX_INTERVAL_MS) || 1000;

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'pedidos',
    port: 5432,
});

let connection;
let channel;
let encerrando = false;

function aguardar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function conectarRabbitMQ() {
    if (channel) return channel;

    connection = await amqp.connect(RABBITMQ_URL);
    connection.on('close', () => {
        connection = null;
        channel = null;
    });
    connection.on('error', error => {
        console.error(`[Outbox] Erro na conexão com RabbitMQ: ${error.message}`);
    });

    channel = await connection.createConfirmChannel();
    await channel.assertQueue(QUEUE, { durable: true });
    return channel;
}

async function publicarProximoEvento() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const result = await client.query(`
            SELECT id, tipo, payload
            FROM outbox_events
            WHERE publicado_em IS NULL
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            await client.query('COMMIT');
            return false;
        }

        const evento = result.rows[0];
        const rabbitChannel = await conectarRabbitMQ();
        const mensagem = JSON.stringify({
            id: evento.id,
            evento: evento.tipo,
            dados: evento.payload
        });

        rabbitChannel.sendToQueue(
            QUEUE,
            Buffer.from(mensagem),
            { persistent: true, messageId: String(evento.id) }
        );
        await rabbitChannel.waitForConfirms();

        await client.query(
            'UPDATE outbox_events SET publicado_em = NOW() WHERE id = $1',
            [evento.id]
        );
        await client.query('COMMIT');
        console.log(`[Outbox] Evento #${evento.id} publicado com sucesso.`);
        return true;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[Outbox] Publicação adiada: ${error.message}`);

        if (channel) {
            await channel.close().catch(() => {});
            channel = null;
        }
        return false;
    } finally {
        client.release();
    }
}

async function iniciar() {
    console.log('[Outbox] Worker iniciado.');

    while (!encerrando) {
        try {
            const publicou = await publicarProximoEvento();
            if (!publicou) await aguardar(INTERVALO_MS);
        } catch (error) {
            console.error(`[Outbox] Banco indisponível: ${error.message}`);
            await aguardar(5000);
        }
    }
}

async function encerrar() {
    encerrando = true;
    await channel?.close().catch(() => {});
    await connection?.close().catch(() => {});
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

iniciar();
