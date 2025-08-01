// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT']
  }
});

// Conexão com banco PostgreSQL (Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// Rota raiz
app.get('/', (req, res) => {
  res.send('API do Centro de Compra funcionando!');
});

// GET todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// POST novo produto
app.post('/api/produtos', async (req, res) => {
  const { nome, descricao, preco, imagem, categoria, loja } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO produtos (nome, descricao, preco, imagem, categoria, loja) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nome, descricao, preco, imagem, categoria, loja]
    );
    io.emit('novoProduto');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

// PUT atualizar produto
app.put('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, imagem, categoria, loja } = req.body;
  try {
    const result = await pool.query(
      'UPDATE produtos SET nome=$1, descricao=$2, preco=$3, imagem=$4, categoria=$5, loja=$6 WHERE id=$7 RETURNING *',
      [nome, descricao, preco, imagem, categoria, loja, id]
    );
    io.emit('produtoAtualizado');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// DELETE produto
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
    io.emit('produtoExcluido');
    res.json({ message: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
});

// Conexão WebSocket
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
