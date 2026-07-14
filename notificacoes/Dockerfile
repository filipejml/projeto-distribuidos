FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
# Não há porta EXPOSE porque este serviço apenas escuta o RabbitMQ
CMD ["node", "index.js"]