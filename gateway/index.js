const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// No Docker, os hosts são os nomes dos containers
const ESTOQUE_URL = process.env.ESTOQUE_URL || 'http://localhost:3001';
const PEDIDOS_URL = process.env.PEDIDOS_URL || 'http://localhost:3002';

// Configurando o Axios com TIMEOUT 
const apiClient = axios.create({
    timeout: 3000 
});

function validarPedido({ produto, quantidade }) {
    if (typeof produto !== 'string' || produto.trim().length === 0) {
        return "O campo 'produto' deve ser uma string não vazia.";
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        return "O campo 'quantidade' deve ser um número inteiro maior que zero.";
    }

    return null;
}

app.post('/pedido', async (req, res) => {
    const { produto, quantidade } = req.body;
    const erroValidacao = validarPedido({ produto, quantidade });

    if (erroValidacao) {
        return res.status(400).json({ erro: erroValidacao });
    }

    const produtoNormalizado = produto.trim();
    let reservaId = null;

    try {
        // PASSO 1: Tenta reservar o produto no Serviço de Estoque
        console.log(`[Gateway] Solicitando reserva de ${quantidade}x ${produtoNormalizado}...`);
        const estoqueRes = await apiClient.post(`${ESTOQUE_URL}/reservar`, { produto: produtoNormalizado, quantidade });
        reservaId = estoqueRes.data.reservaId;

        // PASSO 2: Com o estoque reservado, chama o Serviço de Pedidos
        console.log(`[Gateway] Reserva ${reservaId} confirmada. Criando pedido no banco...`);
        const pedidoRes = await apiClient.post(`${PEDIDOS_URL}/criar`, { produto: produtoNormalizado, quantidade, reservaId });

        // PASSO 3: Sucesso absoluto
        return res.status(201).json({
            mensagem: "Pedido processado com sucesso!",
            pedido: pedidoRes.data
        });

    } catch (error) {
        console.error(`[Gateway] Erro detectado no fluxo: ${error.message}`);

        // TOLERÂNCIA A FALHAS: 
        if (reservaId && error.config && error.config.url.includes('/criar')) {
            console.log(`[Gateway] Falha ao criar pedido. Iniciando ROLLBACK da reserva ${reservaId}...`);
            try {
                await axios.post(`${ESTOQUE_URL}/cancelar-reserva`, { reservaId });
                console.log(`[Gateway] Rollback do estoque concluído com sucesso.`);
            } catch (rollbackError) {
                console.error(`[Gateway] ALERTA CRÍTICO: Falha ao cancelar reserva no estoque: ${rollbackError.message}`);
            }
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(503).json({ 
                erro: "Serviço interno demorou a responder (Timeout). Tente novamente mais tarde." 
            });
        }

        return res.status(500).json({ 
            erro: "Falha na comunicação entre os microsserviços.", 
            detalhe: error.response?.data || error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Gateway (API Principal) operando na porta ${PORT}`);
});
