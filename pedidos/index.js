const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const FORMATO_RESERVA_ID = /^RES-\d+$/;

function validarCriacaoPedido({ produto, quantidade, reservaId }) {
    if (typeof produto !== 'string' || produto.trim().length === 0) {
        return "O campo 'produto' deve ser uma string não vazia.";
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        return "O campo 'quantidade' deve ser um número inteiro maior que zero.";
    }

    if (typeof reservaId !== 'string' || !FORMATO_RESERVA_ID.test(reservaId)) {
        return "O campo 'reservaId' é obrigatório e deve seguir o formato RES-<números>.";
    }

    return null;
}

// Conexão com o banco isolado de Pedidos
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'pedidos',
    port: 5432,
});

// As duas tabelas precisam existir antes de aceitar pedidos.
const schemaPronto = pool.query(`
    CREATE TABLE IF NOT EXISTS compras (
        id SERIAL PRIMARY KEY,
        produto VARCHAR(100) NOT NULL,
        quantidade INT NOT NULL,
        reserva_id VARCHAR(100) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox_events (
        id BIGSERIAL PRIMARY KEY,
        tipo VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        publicado_em TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_events_pendentes
        ON outbox_events (id)
        WHERE publicado_em IS NULL;
`);

app.post('/criar', async (req, res) => {
    const { produto, quantidade, reservaId } = req.body;
    const erroValidacao = validarCriacaoPedido({ produto, quantidade, reservaId });

    if (erroValidacao) {
        return res.status(400).json({ erro: erroValidacao });
    }

    const produtoNormalizado = produto.trim();
    let client;

    try {
        await schemaPronto;
        client = await pool.connect();
        await client.query('BEGIN');

        console.log(`[Pedidos] Gravando pedido do produto ${produtoNormalizado}...`);

        const result = await client.query(
            'INSERT INTO compras (produto, quantidade, reserva_id) VALUES ($1, $2, $3) RETURNING id',
            [produtoNormalizado, quantidade, reservaId]
        );
        const pedidoId = result.rows[0].id;

        const evento = {
            pedidoId,
            produto: produtoNormalizado,
            quantidade,
            reservaId
        };

        // Pedido e evento são confirmados atomicamente no mesmo banco.
        await client.query(
            'INSERT INTO outbox_events (tipo, payload) VALUES ($1, $2::jsonb)',
            ['pedido_criado', JSON.stringify(evento)]
        );

        await client.query('COMMIT');

        return res.status(201).json({ pedidoId, status: "CONCLUIDO" });
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`[Pedidos] Erro ao gravar pedido: ${error.message}`);
        return res.status(500).json({ erro: "Falha ao processar o pedido." });
    } finally {
        client?.release();
    }
});

app.listen(PORT, () => {
    console.log(`Serviço de Pedidos operando na porta ${PORT}`);
});
