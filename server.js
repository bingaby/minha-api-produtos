// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const socketIo = require('socket.io');
const http = require('http');
const fs = require('fs').promises;
const bcrypt = require('bcrypt'); // Biblioteca para hash de senha
const jwt = require('jsonwebtoken'); // Para criar tokens de login

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'https://www.centrodecompra.com.br',
      'https://minha-api-produtos.onrender.com',
      'https://centrodecompra.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false }
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://www.centrodecompra.com.br',
    'https://minha-api-produtos.onrender.com',
    'https://centrodecompra.onrender.com'
  ],
  credentials: true
}));
app.use(express.json());

// Função para autenticar o token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Token não fornecido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ status: 'error', message: 'Token inválido' });
    }
    req.user = user;
    next();
  });
}

// Rota de login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  // Verifica se o nome de usuário e a senha correspondem ao que está nas variáveis de ambiente
  if (username === adminUsername && bcrypt.compareSync(password, adminPasswordHash)) {
    const user = { username: adminUsername };
    const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
    return res.json({ status: 'success', token: accessToken });
  } else {
    return res.status(401).json({ status: 'error', message: 'Credenciais inválidas' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'success', message: 'API e banco de dados estão funcionando' });
  } catch (error) {
    console.error('Erro no health check:', error);
    res.status(500).json({ status: 'error', message: 'Erro no servidor ou banco de dados' });
  }
});

// Adicionar produto (agora com autenticação JWT)
app.post('/api/produtos', upload.array('imagens', 5), authenticateToken, async (req, res) => {
  // ... (o restante do código da sua rota POST)
});

// Buscar produtos
app.get('/api/produtos', async (req, res) => {
  // ... (o restante do código da sua rota GET)
});

// Outras rotas (PUT, DELETE) podem ser adicionadas aqui
// Exemplo: app.put('/api/produtos/:id', authenticateToken, async (req, res) => { ... });

server.listen(process.env.PORT || 3000, () => {
  console.log('Servidor rodando na porta', process.env.PORT || 3000);
});
