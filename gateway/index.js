const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// No Docker, os hosts são os nomes dos containers
const ESTOQUE_URL = process.env.ESTOQUE_URL || 'http://localhost:3001';
const PEDIDOS_URL = process.env.PEDIDOS_URL || 'http://localhost:3002';
const FORMATO_RESERVA_ID = /^RES-\d+$/;
const ETAPA = Object.freeze({
    RESERVA: 'RESERVA',
    CRIACAO_PEDIDO: 'CRIACAO_PEDIDO'
});

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

class RespostaInvalidaError extends Error {
    constructor(servico) {
        super(`O serviço de ${servico} retornou uma resposta inválida.`);
        this.name = 'RespostaInvalidaError';
    }
}

function mapearErro(error) {
    if (error instanceof RespostaInvalidaError) {
        return { status: 502, mensagem: error.message };
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return {
            status: 503,
            mensagem: "Serviço interno demorou a responder. Tente novamente mais tarde."
        };
    }

    if (!error.response) {
        return {
            status: 503,
            mensagem: "Serviço interno indisponível. Tente novamente mais tarde."
        };
    }

    const mensagemServico = error.response.data?.erro;

    switch (error.response.status) {
        case 400:
            return { status: 400, mensagem: mensagemServico || "Requisição inválida." };
        case 404:
            return { status: 404, mensagem: mensagemServico || "Produto não encontrado." };
        case 409:
            return { status: 409, mensagem: mensagemServico || "Conflito ao processar o pedido." };
        default:
            return { status: 502, mensagem: "Falha na resposta de um serviço interno." };
    }
}

app.post('/pedido', async (req, res) => {
    const { produto, quantidade } = req.body;
    const erroValidacao = validarPedido({ produto, quantidade });

    if (erroValidacao) {
        return res.status(400).json({ erro: erroValidacao });
    }

    const produtoNormalizado = produto.trim();
    let reservaId = null;
    let etapaAtual = ETAPA.RESERVA;

    try {
        // PASSO 1: Tenta reservar o produto no Serviço de Estoque
        console.log(`[Gateway] Solicitando reserva de ${quantidade}x ${produtoNormalizado}...`);
        const estoqueRes = await apiClient.post(`${ESTOQUE_URL}/reservar`, { produto: produtoNormalizado, quantidade });

        if (!FORMATO_RESERVA_ID.test(estoqueRes.data?.reservaId) || estoqueRes.data?.status !== 'RESERVADO') {
            throw new RespostaInvalidaError('estoque');
        }

        reservaId = estoqueRes.data.reservaId;
        etapaAtual = ETAPA.CRIACAO_PEDIDO;

        // PASSO 2: Com o estoque reservado, chama o Serviço de Pedidos
        console.log(`[Gateway] Reserva ${reservaId} confirmada. Criando pedido no banco...`);
        const pedidoRes = await apiClient.post(`${PEDIDOS_URL}/criar`, { produto: produtoNormalizado, quantidade, reservaId });

        if (!Number.isInteger(pedidoRes.data?.pedidoId) || pedidoRes.data?.status !== 'CONCLUIDO') {
            throw new RespostaInvalidaError('pedidos');
        }

        // PASSO 3: Sucesso absoluto
        return res.status(201).json({
            mensagem: "Pedido processado com sucesso!",
            pedido: pedidoRes.data
        });

    } catch (error) {
        console.error(`[Gateway] Erro detectado no fluxo: ${error.message}`);

        // Compensa somente quando a etapa de reserva já foi concluída.
        if (etapaAtual === ETAPA.CRIACAO_PEDIDO && reservaId) {
            console.log(`[Gateway] Falha ao criar pedido. Iniciando ROLLBACK da reserva ${reservaId}...`);
            try {
                await apiClient.post(`${ESTOQUE_URL}/cancelar-reserva`, { reservaId });
                console.log(`[Gateway] Rollback do estoque concluído com sucesso.`);
            } catch (rollbackError) {
                console.error(`[Gateway] ALERTA CRÍTICO: Falha ao cancelar reserva no estoque: ${rollbackError.message}`);
            }
        }

        const erroHttp = mapearErro(error);
        return res.status(erroHttp.status).json({ erro: erroHttp.mensagem });
    }
});

app.listen(PORT, () => {
    console.log(`Gateway (API Principal) operando na porta ${PORT}`);
});
