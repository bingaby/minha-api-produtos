const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(cors({
  origin: ['https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configurações do banco, cloudinary, multer, jwt etc...

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: 5432,
  ssl: { rejectUnauthorized: false },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'centrodecompra',
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }],
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Mapa para guardar sockets identificados
const connectedClients = new Map();

io.on('connection', (socket) => {
  const clientId = socket.handshake.query.clientId || 'unknown';
  console.log(`Cliente conectado: ${clientId} (socket id: ${socket.id})`);

  connectedClients.set(clientId, socket);

  socket.on('mensagem-para-servidor', (data) => {
    console.log(`Mensagem do ${clientId}:`, data);
    socket.emit('resposta-do-servidor', { msg: 'Recebido com sucesso!' });
  });

  // Comunicação específica entre index e admin-xyz-123
  if (clientId === 'index' && connectedClients.has('admin-xyz-123')) {
    const adminSocket = connectedClients.get('admin-xyz-123');
    adminSocket.emit('notificacao', { de: 'index', texto: 'Usuário index está online' });
  } else if (clientId === 'admin-xyz-123' && connectedClients.has('index')) {
    const indexSocket = connectedClients.get('index');
    indexSocket.emit('notificacao', { de: 'admin', texto: 'Administrador conectado' });
  }

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${clientId} (socket id: ${socket.id})`);
    connectedClients.delete(clientId);
  });
});

// Outras rotas e middlewares aqui...

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
