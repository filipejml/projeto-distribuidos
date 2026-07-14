CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) UNIQUE NOT NULL,
    quantidade INT NOT NULL CHECK (quantidade >= 0)
);

CREATE TABLE IF NOT EXISTS reservas (
    reserva_id VARCHAR(100) PRIMARY KEY,
    produto VARCHAR(100) NOT NULL REFERENCES produtos(nome),
    quantidade INT NOT NULL CHECK (quantidade > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVA'
        CHECK (status IN ('ATIVA', 'CANCELADA')),
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelada_em TIMESTAMPTZ
);

-- Inserindo o produto de teste que será usado na avaliação
INSERT INTO produtos (nome, quantidade) VALUES ('Notebook', 2) ON CONFLICT DO NOTHING;
