const express = require('express');
const { Pool } = require('pg');
const { randomInt } = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Configuração de conexão com o PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'estoque',
    port: 5432,
});

const FORMATO_RESERVA_ID = /^RES-\d+$/;

const schemaPronto = pool.query(`
    CREATE TABLE IF NOT EXISTS reservas (
        reserva_id VARCHAR(100) PRIMARY KEY,
        produto VARCHAR(100) NOT NULL REFERENCES produtos(nome),
        quantidade INT NOT NULL CHECK (quantidade > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'ATIVA'
            CHECK (status IN ('ATIVA', 'CANCELADA')),
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cancelada_em TIMESTAMPTZ
    )
`);

function validarProdutoEQuantidade({ produto, quantidade }) {
    if (typeof produto !== 'string' || produto.trim().length === 0) {
        return "O campo 'produto' deve ser uma string não vazia.";
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        return "O campo 'quantidade' deve ser um número inteiro maior que zero.";
    }

    return null;
}

function reservaIdValida(reservaId) {
    return typeof reservaId === 'string' && FORMATO_RESERVA_ID.test(reservaId);
}

app.post('/reservar', async (req, res) => {
    const { produto, quantidade } = req.body;
    const erroValidacao = validarProdutoEQuantidade({ produto, quantidade });

    if (erroValidacao) {
        return res.status(400).json({ erro: erroValidacao });
    }

    const produtoNormalizado = produto.trim();
    const reservaId = `RES-${Date.now()}${randomInt(100000, 1000000)}`;
    let client;

    try {
        await schemaPronto;
        client = await pool.connect();
        console.log(`[Estoque] Tentando reservar ${quantidade}x ${produtoNormalizado}...`);
        
        // INÍCIO DA TRANSAÇÃO
        await client.query('BEGIN');


        const resQuery = await client.query(
            'SELECT id, quantidade FROM produtos WHERE nome = $1 FOR UPDATE',
            [produtoNormalizado]
        );

        if (resQuery.rows.length === 0) {
            throw new Error("Produto não encontrado.");
        }

        const estoqueAtual = resQuery.rows[0].quantidade;

        if (estoqueAtual < quantidade) {
            throw new Error("Estoque insuficiente.");
        }

        // Atualiza o estoque
        await client.query(
            'UPDATE produtos SET quantidade = quantidade - $1 WHERE nome = $2',
            [quantidade, produtoNormalizado]
        );

        // A reserva e a redução do estoque são persistidas atomicamente.
        await client.query(
            `INSERT INTO reservas (reserva_id, produto, quantidade, status)
             VALUES ($1, $2, $3, 'ATIVA')`,
            [reservaId, produtoNormalizado, quantidade]
        );

        await client.query('COMMIT');

        console.log(`[Estoque] Reserva ${reservaId} efetuada com sucesso. Restam: ${estoqueAtual - quantidade}`);
        
        return res.status(200).json({ reservaId, status: "RESERVADO" });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`[Estoque] Falha na reserva: ${error.message}`);
        return res.status(400).json({ erro: error.message });
    } finally {
        client?.release();
    }
});

// Rota de COMPENSAÇÃO 
app.post('/cancelar-reserva', async (req, res) => {
    const { reservaId } = req.body;

    if (!reservaIdValida(reservaId)) {
        return res.status(400).json({
            erro: "O campo 'reservaId' é obrigatório e deve seguir o formato RES-<números>."
        });
    }

    let client;

    try {
        await schemaPronto;
        client = await pool.connect();
        await client.query('BEGIN');

        // Serializa cancelamentos concorrentes da mesma reserva.
        const result = await client.query(
            `SELECT produto, quantidade, status
             FROM reservas
             WHERE reserva_id = $1
             FOR UPDATE`,
            [reservaId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: "Reserva não encontrada." });
        }

        const { produto, quantidade, status } = result.rows[0];

        if (status === 'CANCELADA') {
            await client.query('COMMIT');
            return res.status(200).json({
                status: "CANCELADO_COM_SUCESSO",
                jaEstavaCancelada: true
            });
        }

        await client.query(
            'UPDATE produtos SET quantidade = quantidade + $1 WHERE nome = $2',
            [quantidade, produto]
        );

        await client.query(
            `UPDATE reservas
             SET status = 'CANCELADA', cancelada_em = NOW()
             WHERE reserva_id = $1`,
            [reservaId]
        );

        await client.query('COMMIT');
        console.log(`[Estoque] Rollback da reserva ${reservaId} concluído. ${quantidade}x ${produto} devolvidos.`);
        return res.status(200).json({
            status: "CANCELADO_COM_SUCESSO",
            jaEstavaCancelada: false
        });
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`[Estoque] Erro ao devolver estoque: ${error.message}`);
        return res.status(500).json({ erro: "Falha crítica na compensação do estoque." });
    } finally {
        client?.release();
    }
});

app.listen(PORT, () => {
    console.log(`Serviço de Estoque operando na porta ${PORT}`);
});
