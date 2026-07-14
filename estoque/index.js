const express = require('express');
const { Pool } = require('pg');

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

// Banco de dados em memória temporário 
const reservasAtivas = new Map();
const FORMATO_RESERVA_ID = /^RES-\d+$/;

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
    
    // Inicia um cliente isolado
    const client = await pool.connect();

    try {
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

        // FIM 
        await client.query('COMMIT');

        // Gera um ID de reserva 
        const reservaId = `RES-${Date.now()}`;
        reservasAtivas.set(reservaId, { produto: produtoNormalizado, quantidade });

        console.log(`[Estoque] Reserva ${reservaId} efetuada com sucesso. Restam: ${estoqueAtual - quantidade}`);
        
        return res.status(200).json({ reservaId, status: "RESERVADO" });

    } catch (error) {
        // Se algo der errado = rollback
        await client.query('ROLLBACK');
        console.error(`[Estoque] Falha na reserva: ${error.message}`);
        return res.status(400).json({ erro: error.message });
    } finally {
        // Libera o cliente de volta para o pool
        client.release();
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

    if (!reservasAtivas.has(reservaId)) {
        return res.status(404).json({ erro: "Reserva não encontrada." });
    }

    const { produto, quantidade } = reservasAtivas.get(reservaId);
    
    try {
        // Devolve o produto ao estoque
        await pool.query(
            'UPDATE produtos SET quantidade = quantidade + $1 WHERE nome = $2',
            [quantidade, produto]
        );
        
        reservasAtivas.delete(reservaId);
        console.log(`[Estoque] Rollback da reserva ${reservaId} concluído. ${quantidade}x ${produto} devolvidos.`);
        return res.status(200).json({ status: "CANCELADO_COM_SUCESSO" });
    } catch (error) {
        console.error(`[Estoque] Erro ao devolver estoque: ${error.message}`);
        return res.status(500).json({ erro: "Falha crítica na compensação do estoque." });
    }
});

app.listen(PORT, () => {
    console.log(`Serviço de Estoque operando na porta ${PORT}`);
});
