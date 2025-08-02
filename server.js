// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Cria app Express
const app = express();

// Cria servidor HTTP usando o app Express
const server = http.createServer(app);

// Inicializa Socket.IO no servidor HTTP
const io = new Server(server);

// Rota básica para teste
app.get('/', (req, res) => {
  res.send('Servidor rodando com Express e Socket.IO!');
});

// Evento de conexão Socket.IO
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Exemplo: ouvir mensagem do cliente
  socket.on('mensagem', (msg) => {
    console.log('Mensagem recebida do cliente:', msg);
    // Enviar resposta para cliente
    socket.emit('resposta', `Recebido: ${msg}`);
  });

  // Evento desconectar
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Porta do servidor
const PORT = process.env.PORT || 3000;

// Inicia servidor
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
