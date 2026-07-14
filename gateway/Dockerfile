# Usa uma imagem leve do Node.js
FROM node:18-alpine

# Define a pasta de trabalho dentro do container
WORKDIR /usr/src/app

# Copia apenas os arquivos de dependências primeiro (otimiza o cache do Docker)
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta que o serviço vai rodar
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "index.js"]