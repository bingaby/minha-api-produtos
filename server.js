require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Configuração do Multer para upload em memória
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuração do PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Chave secreta para JWT
const jwtSecret = process.env.JWT_SECRET || 'sua_chave_secreta_padrao_muito_segura';

// Função para verificar o token JWT
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) {
    return res.status(401).send('Acesso negado. Token não fornecido.');
  }

  try {
    const user = jwt.verify(token, jwtSecret);
    req.user = user;
    next();
  } catch (err) {
    res.status(403).send('Token inválido.');
  }
};

// ===================================
// ROTAS DO BACKEND
// ===================================

// Rota de login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminUsername || !adminPasswordHash) {
      return res.status(500).send('Configuração de credenciais de administrador ausente.');
    }

    if (username === adminUsername && await bcrypt.compare(password, adminPasswordHash)) {
      const token = jwt.sign({ username: adminUsername }, jwtSecret, { expiresIn: '1h' });
      res.json({ token });
    } else {
      res.status(401).send('Nome de usuário ou senha inválidos.');
    }
  } catch (err) {
    console.error('Erro durante o login:', err);
    res.status(500).send('Erro interno do servidor.');
  }
});

// Rota para cadastrar um novo produto (acesso restrito)
app.post('/api/produtos', authenticateToken, upload.array('imagens', 10), async (req, res) => {
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  if (!nome || !descricao || !preco || !link || !categoria || !loja || !imagens || imagens.length === 0) {
    return res.status(400).send('Todos os campos, incluindo as imagens, são obrigatórios.');
  }

  try {
    const uploadedImages = await Promise.all(imagens.map(async (file) => {
      const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
        folder: 'produtos',
      });
      return result.secure_url;
    }));

    const client = await pool.connect();
    const query = 'INSERT INTO produtos (nome, descricao, preco, link, categoria, loja, imagens) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *';
    const values = [nome, descricao, preco, link, categoria, loja, uploadedImages];

    const result = await client.query(query, values);
    client.release();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).send('Erro interno do servidor.');
  }
});

// Rota para buscar todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM produtos ORDER BY id DESC');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).send('Erro interno do servidor.');
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
