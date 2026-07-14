# Sistema Distribuído de Pedidos

Aplicação acadêmica baseada em microsserviços para demonstrar comunicação síncrona e assíncrona, bancos de dados isolados, controle de concorrência e compensação de operações em um fluxo de pedidos.

## Funcionalidades

- Criação de pedidos por meio de uma API Gateway.
- Reserva de produtos com validação de disponibilidade em estoque.
- Controle de concorrência no estoque por transação e bloqueio de linha (`SELECT ... FOR UPDATE`).
- Persistência de pedidos e produtos em bancos PostgreSQL separados.
- Compensação da reserva quando a criação do pedido falha.
- Timeout nas chamadas entre a API Gateway e os microsserviços.
- Publicação assíncrona do evento `pedido_criado` no RabbitMQ.
- Persistência atômica de pedidos e eventos com Transactional Outbox.
- Consumo de eventos pelo serviço de notificações.
- Confirmação de mensagens com ACK e fila durável.
- Controle simples de idempotência para evitar notificações duplicadas durante a execução do consumidor.
- Execução isolada dos componentes com Docker Compose.

## Arquitetura

```text
Cliente
  |
  | POST /pedido
  v
API Gateway (porta 3000)
  |
  +-- POST /reservar ------> Serviço de Estoque (porta 3001)
  |                              |
  |                              +--> PostgreSQL Estoque (porta 5434 no host)
  |
  +-- POST /criar ---------> Serviço de Pedidos (porta 3002)
                                 |
                                 +--> PostgreSQL Pedidos (porta 5433 no host)
                                 |
                                 +--> Tabela Outbox
                                          |
                                          v
                                    Worker Outbox
                                          |
                                          v
                                      RabbitMQ (porta 5672)
                                          |
                                          v
                                 Serviço de Notificações
```

Todos os componentes são conectados pela rede Docker `uespi_network`.

## Componentes

### API Gateway

Ponto de entrada da aplicação. Recebe o pedido, solicita a reserva ao serviço de estoque e, após a confirmação, encaminha a criação ao serviço de pedidos.

Se a reserva for concluída e a criação do pedido falhar, a Gateway chama a rota de cancelamento para devolver a quantidade reservada. As chamadas internas possuem timeout de três segundos.

### Serviço de Estoque

Mantém os produtos no PostgreSQL e disponibiliza operações para reservar ou cancelar uma reserva. A redução da quantidade ocorre em uma transação com bloqueio da linha do produto, impedindo que requisições concorrentes consumam a mesma unidade.

As reservas ativas são mantidas temporariamente em memória para permitir a compensação.

### Serviço de Pedidos

Registra a compra e o evento `pedido_criado` em uma única transação PostgreSQL. Assim, não existe pedido confirmado sem que o evento correspondente também esteja armazenado.

### Worker Outbox

Busca eventos ainda não publicados na tabela `outbox_events`, envia-os para a fila `fila_notificacoes` usando confirmação do RabbitMQ e marca cada evento como publicado. Quando o broker está indisponível, o evento permanece pendente e uma nova tentativa ocorre posteriormente.

### Serviço de Notificações

Atua exclusivamente como consumidor do RabbitMQ. Ao receber um evento de pedido criado, simula o envio de um e-mail por meio de uma mensagem no log e confirma o processamento com ACK.

### Infraestrutura

- **PostgreSQL:** dois bancos independentes, um para estoque e outro para pedidos.
- **RabbitMQ:** broker responsável pela comunicação assíncrona entre pedidos e notificações.
- **Docker Compose:** cria os serviços, bancos, broker e rede interna.

## Fluxo de um pedido

1. O cliente envia `POST /pedido` para a API Gateway.
2. A Gateway solicita uma reserva ao serviço de estoque.
3. O estoque bloqueia o produto, valida a quantidade, reduz o saldo e confirma a transação.
4. A Gateway solicita ao serviço de pedidos que persista a compra.
5. O serviço de pedidos grava a compra e o evento Outbox na mesma transação.
6. O Worker Outbox publica o evento pendente no RabbitMQ e registra sua publicação.
7. O serviço de notificações consome o evento e simula o aviso ao cliente.
8. Se a etapa de criação do pedido falhar após a reserva, a Gateway solicita a compensação do estoque.

## Tecnologias

- Node.js 18
- Express
- Axios
- PostgreSQL 15
- `pg`
- RabbitMQ
- `amqplib`
- Docker e Docker Compose

## Estrutura do projeto

```text
.
|-- docker-compose.yaml       # Orquestra os microsserviços e a infraestrutura
|-- comandos                  # Exemplos de chamadas e teste de concorrência
|-- estoque/
|   |-- index.js             # API de reserva e compensação de estoque
|   |-- ini.sql              # Criação e carga inicial da tabela de produtos
|   |-- Dockerfile
|   `-- package.json
|-- gateway/
|   |-- index.js             # Entrada pública e coordenação do fluxo
|   |-- Dockerfile
|   `-- package.json
|-- pedidos/
|   |-- index.js             # Persistência e publicação de eventos
|   |-- outbox-worker.js     # Publicação confiável dos eventos pendentes
|   |-- Dockerfile
|   `-- package.json
|-- notificacoes/
|   |-- index.js             # Consumidor de eventos do RabbitMQ
|   |-- Dockerfile
|   `-- package.json
`-- Relatório Técnico - Sistema Distribuído de Pedidos (UESPI).pdf
```

## API

### Criar pedido

```http
POST /pedido
Content-Type: application/json
```

Corpo da requisição:

```json
{
  "produto": "Notebook",
  "quantidade": 1
}
```

Exemplo com `curl`:

```bash
curl -X POST http://localhost:3000/pedido \
  -H "Content-Type: application/json" \
  -d '{"produto":"Notebook","quantidade":1}'
```

Resposta de sucesso:

```json
{
  "mensagem": "Pedido processado com sucesso!",
  "pedido": {
    "pedidoId": 1,
    "status": "CONCLUIDO"
  }
}
```

As rotas `/reservar`, `/cancelar-reserva` e `/criar` são usadas internamente entre os microsserviços.

## Portas

| Componente | Porta no host |
|---|---:|
| API Gateway | 3000 |
| Serviço de Estoque | 3001 |
| Serviço de Pedidos | 3002 |
| PostgreSQL de Pedidos | 5433 |
| PostgreSQL de Estoque | 5434 |
| RabbitMQ (AMQP) | 5672 |
| RabbitMQ Management | 15672 |

## Execução

É necessário ter Docker e Docker Compose instalados. Para construir e iniciar a aplicação, execute:

```bash
docker compose up --build
```

Para acompanhar os contêineres:

```bash
docker compose ps
```

Para encerrar:

```bash
docker compose down
```

O painel do RabbitMQ fica disponível em `http://localhost:15672`.

## Observações

- O controle de reservas e a idempotência das notificações são armazenados em memória e são perdidos quando os respectivos serviços reiniciam.
- A confirmação da reserva não é persistida em uma tabela própria.
- O projeto não possui suíte de testes automatizados; o arquivo `comandos` contém exemplos para testes manuais, inclusive de concorrência.
