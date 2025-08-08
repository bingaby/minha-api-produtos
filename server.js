const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://www.centrodecompra.com.br',
  'https://centrodecompra.com.br',
  'https://index',           // Substitua pelo domínio real do frontend index
  'https://admin-xyz-123'   // Substitua pelo domínio real do admin
];

// Configura CORS para frontend autorizados
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração PostgreSQL
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false }, // Ajuste se for local
});

// Configuração Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer + Cloudinary Storage para upload de imagens
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

// Middleware de autenticação JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// Rota health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Rota pública para login (exemplo simples, ajusta para sua lógica)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // Só um exemplo, faça validação real no banco
  if (username === 'admin' && password === '123456') {
    const user = { username: 'admin' };
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Usuário ou senha inválidos' });
});

// Rota para obter produtos (protegida)
app.get('/api/produtos', authenticateToken, async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const offset = (page - 1) * limit;

  try {
    const queryText = `
      SELECT * FROM produtos
      WHERE nome ILIKE $1 OR descricao ILIKE $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
    `;
    const values = [`%${search}%`, limit, offset];
    const result = await pool.query(queryText, values);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM produtos WHERE nome ILIKE $1 OR descricao ILIKE $1`,
      [`%${search}%`]
    );

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
    });
  } catch (error) {
    console.error('Erro ao obter produtos:', error);
    res.status(500).json({ success: false, error: 'Erro ao obter produtos' });
  }
});

// Rota para upload de imagem (exemplo)
app.post('/api/upload', authenticateToken, upload.single('imagem'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  res.json({ success: true, url: req.file.path });
});

// Socket.io configuração
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Lista de domínios autorizados para socket
io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if (allowedOrigins.includes(origin)) {
    next();
  } else {
    next(new Error('Origem não autorizada'));
  }
});

io.on('connection', (socket) => {
  console.log('Usuário conectado via socket:', socket.id);

  socket.on('mensagem', (msg) => {
    console.log('Mensagem recebida:', msg);
    // exemplo: reenvia para todos
    io.emit('mensagem', msg);
  });

  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
  });
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
