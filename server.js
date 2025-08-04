const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Lista de categorias e lojas permitidas
const CATEGORIAS_PERMITIDAS = [
    'eletronicos', 'moda', 'fitness', 'casa', 'beleza', 'esportes', 'livros',
    'infantil', 'Celulares', 'Eletrodomésticos', 'pet', 'jardinagem', 'automotivo',
    'gastronomia', 'games'
];
const LOJAS_PERMITIDAS = ['amazon', 'magalu', 'shein', 'shopee', 'mercadolivre', 'alibaba'];

// Configuração do CORS
const allowedOrigins = [
    'http://localhost:3000',
    'https://www.centrodecompra.com.br',
    'https://minha-api-produtos.onrender.com',
    // Adicione o domínio do frontend hospedado no Render, ex.: 'https://seu-frontend.onrender.com'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
}));
app.use(express.json());

// Middleware de autenticação básica
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'seu_token_secreto';
    if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
        return res.status(401).json({ status: 'error', message: 'Autenticação necessária' });
    }
    next();
};

// Configuração do banco de dados
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
    ssl: { rejectUnauthorized: false },
});

// Criar tabela produtos se não existir
pool.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL:', err);
        process.exit(1);
    }
    console.log('Conectado ao PostgreSQL');
    pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            descricao TEXT,
            preco NUMERIC NOT NULL,
            imagens TEXT[] NOT NULL,
            categoria TEXT NOT NULL,
            loja TEXT NOT NULL,
            link TEXT NOT NULL
        );
    `, (err) => {
        if (err) {
            console.error('Erro ao criar tabela produtos:', err);
            process.exit(1);
        }
        console.log('Tabela produtos criada ou verificada');
    });
});

// Configuração do Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuração do Socket.IO
const server = require('http').createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
});

io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Cache simples em memória
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Rota para buscar produtos
app.get('/api/produtos', async (req, res) => {
    try {
        const { categoria, loja, busca, page = 1, limit = 12 } = req.query;
        const offset = (page - 1) * limit;
        console.log('Parâmetros recebidos:', { categoria, loja, busca, page, limit });

        if (categoria && categoria !== 'todas' && !CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: 'Categoria inválida' });
        }
        if (loja && loja !== 'todas' && !LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: 'Loja inválida' });
        }

        const cacheKey = `${categoria || 'todas'}-${loja || 'todas'}-${busca || ''}-${page}-${limit}`;
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_DURATION) {
                console.log('Retornando dados do cache');
                return res.json(cached.data);
            }
        }

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

        const responseData = {
            status: 'success',
            data: rows,
            total: parseInt(countResult.rows[0].count),
        };

        cache.set(cacheKey, { data: responseData, timestamp: Date.now() });
        res.json(responseData);
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar produtos' });
    }
});

// Rota para adicionar produto
app.post('/api/produtos', authenticate, upload.array('imagens', 5), async (req, res) => {
    try {
        const { nome, descricao, preco, categoria, loja, link } = req.body;
        if (!nome || !preco || !categoria || !loja || !link || !req.files || req.files.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Todos os campos são obrigatórios, incluindo pelo menos uma imagem' });
        }

        if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: 'Categoria inválida' });
        }
        if (!LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: 'Loja inválida' });
        }

        const imageUrls = [];
        for (const file of req.files) {
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { transformation: [{ width: 300, height: 300, crop: 'limit' }] },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
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
        cache.clear();
        res.json({ status: 'success', data: rows
