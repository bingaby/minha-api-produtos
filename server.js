const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Configuração do CORS
const allowedOrigins = ['http://localhost:3000', 'https://www.centrodecompra.com.br'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// Configuração do banco de dados
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT || 5432,
  ssl: { rejectUnauthorized: false }
});

// Criar tabelas se não existirem
pool.connect((err) => {
  if (err) {
    console.error('Erro ao conectar ao PostgreSQL:', err);
    process.exit(1);
  }
  console.log('Conectado ao PostgreSQL');
  pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco NUMERIC NOT NULL,
      imagens TEXT[],
      categoria TEXT NOT NULL,
      loja TEXT NOT NULL,
      link TEXT NOT NULL
    );
  `, (err) => {
    if (err) {
      console.error('Erro ao criar tabelas:', err);
      process.exit(1);
    }
    console.log('Tabelas criadas ou verificadas');
  });
});

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuração do Socket.IO
const server = require('http').createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Middleware para autenticação JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Token não fornecido' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ status: 'error', message: 'Token inválido' });
    }
    if (!user.is_admin) {
      return res.status(403).json({ status: 'error', message: 'Acesso negado: apenas administradores' });
    }
    req.user = user;
    next();
  });
};

// Rota para registrar usuário (apenas para criar admin inicial)
app.post('/api/register', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ status: 'error', message: 'Email e senha são obrigatórios' });
    }
    const hashedPassword = await bcrypt.hash(senha, 10);
    const query = 'INSERT INTO usuarios (email, senha, is_admin) VALUES ($1, $2, $3) RETURNING id, email, is_admin';
    const values = [email, hashedPassword, true];
    const { rows } = await pool.query(query, values);
    res.json({ status: 'success', message: 'Usuário registrado com sucesso' });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao registrar usuário' });
  }
});

// Rota para login
app.post('/api/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const query = 'SELECT * FROM usuarios WHERE email = $1';
    const { rows } = await pool.query(query, [email]);
    if (rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Credenciais inválidas' });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(senha, user.senha);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Credenciais inválidas' });
    }
    const token = jwt.sign({ id: user.id, is_admin: user.is_admin }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ status: 'success', token, is_admin: user.is_admin });
  } catch (error) {
    console.error('Erro ao fazer login:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao fazer login' });
  }
});

// Rota para verificar token
app.get('/api/verify-token', authenticateToken, async (req, res) => {
  try {
    const query = 'SELECT id, email, is_admin FROM usuarios WHERE id = $1';
    const { rows } = await pool.query(query, [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Usuário não encontrado' });
    }
    res.json({ status: 'success', is_admin: rows[0].is_admin });
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao verificar token' });
  }
});

// Rota para buscar produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const { categoria, loja, busca, page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;
    console.log('Parâmetros recebidos:', { categoria, loja, busca, page, limit });

    let query = 'SELECT * FROM produtos';
    const values = [];
    let whereClauses = [];

    if (categoria && categoria !== 'todas') {
      whereClauses.push('categoria = $' + (values.length + 1));
      values.push(categoria);
    }
    if (loja && loja !== 'todas') {
      whereClauses.push('loja = $' + (values.length + 1));
      values.push(loja);
    }
    if (busca) {
      whereClauses.push('nome ILIKE $' + (values.length + 1));
      values.push(`%${busca}%`);
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    const countQuery = `SELECT COUNT(*) FROM produtos${whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : ''}`;
    const countResult = await pool.query(countQuery, values.slice(0, whereClauses.length));

    query += ' ORDER BY id DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);

    const { rows } = await pool.query(query, values);

    res.json({
      status: 'success',
      data: rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao buscar produtos' });
  }
});

// Rota para adicionar produto
app.post('/api/produtos', authenticateToken, upload.array('imagens', 5), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, loja, link } = req.body;
    if (!nome || !preco || !categoria || !loja || !link || !req.files || req.files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Todos os campos são obrigatórios, incluindo pelo menos uma imagem' });
    }

    const imageUrls = [];
    for (const file of req.files) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream((error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
        uploadStream.end(file.buffer);
      });
      imageUrls.push(result.secure_url);
    }

    const query = `
      INSERT INTO produtos (nome, descricao, preco, imagens, categoria, loja, link)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`;
    const values = [nome, descricao, parseFloat(preco), imageUrls, categoria, loja, link];
    const { rows } = await pool.query(query, values);

    io.emit('novoProduto', rows[0]);
    res.json({ status: 'success', data: rows[0], message: 'Produto adicionado com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao adicionar produto' });
  }
});

// Rota para editar produto
app.put('/api/produtos/:id', authenticateToken, upload.array('imagens', 5), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, preco, categoria, loja, link } = req.body;
    if (!nome || !preco || !categoria || !loja || !link) {
      return res.status(400).json({ status: 'error', message: 'Todos os campos são obrigatórios' });
    }

    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream((error, result) => {
            if (error) reject(error);
            else resolve(result);
          });
          uploadStream.end(file.buffer);
        });
        imageUrls.push(result.secure_url);
      }
    }

    const query = `
      UPDATE produtos
      SET nome = $1, descricao = $2, preco = $3, imagens = $4, categoria = $5, loja = $6, link = $7
      WHERE id = $8
      RETURNING *`;
    const values = [
      nome,
      descricao,
      parseFloat(preco),
      imageUrls.length > 0 ? imageUrls : (await pool.query('SELECT imagens FROM produtos WHERE id = $1', [id])).rows[0].imagens,
      categoria,
      loja,
      link,
      id
    ];
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }

    io.emit('produtoAtualizado', rows[0]);
    res.json({ status: 'success', data: rows[0], message: 'Produto atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao atualizar produto' });
  }
});

// Rota para excluir produto
app.delete('/api/produtos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }
    io.emit('produtoExcluido', { id });
    res.json({ status: 'success', message: 'Produto excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao excluir produto' });
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
