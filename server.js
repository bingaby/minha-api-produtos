const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
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

// Criar tabela produtos automaticamente
pool.connect((err) => {
  if (err) {
    console.error('Erro ao conectar ao PostgreSQL:', err);
    process.exit(1);
  }
  console.log('Conectado ao PostgreSQL');
  pool.query(`
    DROP TABLE IF EXISTS produtos;
    CREATE TABLE produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco NUMERIC NOT NULL,
      imagens TEXT[],
      categoria TEXT NOT NULL,
      loja TEXT NOT NULL,
      link TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Erro ao criar tabela produtos:', err);
      process.exit(1);
    }
    console.log('Tabela produtos recriada');
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
app.post('/api/produtos', upload.array('imagens', 5), async (req, res) => {
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
app.put('/api/produtos/:id', upload.array('imagens', 5), async (req, res) => {
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
app.delete('/api/produtos/:id', async (req, res) => {
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
