const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'],
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Configuração do CORS
const allowedOrigins = ['http://localhost:3000', 'https://www.centrodecompra.com.br', 'https://centrodecompra.com.br'];
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

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuração do Multer para upload de imagens
const upload = multer({ storage: multer.memoryStorage() });

// Configuração do PostgreSQL
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT
});

// Criação da tabela produtos, se não existir
pool.query(`
  CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT,
    preco NUMERIC NOT NULL,
    imagens TEXT[],
    categoria TEXT NOT NULL,
    loja TEXT NOT NULL,
    link TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => {
  console.log('Tabela produtos criada ou já existente');
}).catch(err => {
  console.error('Erro ao criar tabela produtos:', err);
});

// Mapeamento de lojas para consistência
const lojaMapping = {
  'magalu': 'magazineluiza.com.br',
  'amazon': 'amazon.com.br',
  'shopee': 'shopee.com.br',
  'shein': 'br.shein.com',
  'alibaba': 'alibaba.com',
  'mercadolivre': 'mercadolivre.com.br'
};

// Rota padrão
app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'API do Centro de Compras está ativa. Use /api/produtos para acessar os produtos.' });
});

// Rota para obter produtos com filtros e paginação
app.get('/api/produtos', async (req, res) => {
  try {
    const { categoria, loja, busca, page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM produtos WHERE 1=1';
    let values = [];

    if (categoria && categoria !== 'todas') {
      values.push(categoria);
      query += ` AND categoria = $${values.length}`;
    }

    if (loja && loja !== 'todas') {
      const lojaDb = Object.keys(lojaMapping).find(key => lojaMapping[key] === loja) ? loja : lojaMapping[loja] || loja;
      values.push(lojaDb);
      query += ` AND loja = $${values.length}`;
    }

    if (busca) {
      values.push(`%${busca}%`);
      query += ` AND (nome ILIKE $${values.length} OR descricao ILIKE $${values.length})`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const countQuery = query.replace('SELECT * FROM produtos', 'SELECT COUNT(*) FROM produtos');
    const countResult = await pool.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);
    const result = await pool.query(query, values);

    const mappedRows = result.rows.map(row => ({
      ...row,
      loja: Object.keys(lojaMapping).find(key => lojaMapping[key] === row.loja) || row.loja
    }));

    res.json({ status: 'success', data: mappedRows, total });
  } catch (error) {
    console.error('Erro ao obter produtos:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao obter produtos' });
  }
});

// Rota para criar um produto
app.post('/api/produtos', upload.array('imagens', 5), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, loja, link } = req.body;

    // Mapear o valor simplificado da loja para o domínio completo
    const lojaDb = lojaMapping[loja] || loja;

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
    const values = [nome, descricao, parseFloat(preco), imageUrls, categoria, lojaDb, link];
    const { rows } = await pool.query(query, values);

    const produto = {
      ...rows[0],
      loja: Object.keys(lojaMapping).find(key => lojaMapping[key] === rows[0].loja) || rows[0].loja
    };

    io.emit('novoProduto', produto);
    res.json({ status: 'success', data: produto });
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao criar produto' });
  }
});

// Rota para atualizar um produto
app.put('/api/produtos/:id', upload.array('imagens', 5), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, preco, categoria, loja, link } = req.body;

    // Mapear o valor simplificado da loja para o domínio completo
    const lojaDb = lojaMapping[loja] || loja;

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
      lojaDb,
      link,
      id
    ];
    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }

    const produto = {
      ...rows[0],
      loja: Object.keys(lojaMapping).find(key => lojaMapping[key] === rows[0].loja) || rows[0].loja
    };

    io.emit('produtoAtualizado', produto);
    res.json({ status: 'success', data: produto });
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ status: 'error', message: 'Erro ao atualizar produto' });
  }
});

// Rota para excluir um produto
app.delete('/api/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT imagens FROM produtos WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
    }

    // Excluir imagens do Cloudinary
    for (const imageUrl of rows[0].imagens) {
      const publicId = imageUrl.split('/').pop().split('.')[0]; // Extrair public_id da URL
      await cloudinary.uploader.destroy(`produtos/${publicId}`).catch(err => {
        console.error(`Erro ao excluir imagem ${publicId} do Cloudinary:`, err);
      });
    }

    const query = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
    const { rows: deletedRows } = await pool.query(query, [id]);

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
