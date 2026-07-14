CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) UNIQUE NOT NULL,
    quantidade INT NOT NULL
);

-- Inserindo o produto de teste que será usado na avaliação
INSERT INTO produtos (nome, quantidade) VALUES ('Notebook', 2) ON CONFLICT DO NOTHING;