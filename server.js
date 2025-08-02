import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import path from 'path';

// Biblioteca para emitir eventos (necessária para Socket.IO)
import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const { Pool } = pkg;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Permite qualquer origem para o Socket.IO
    }
});
const port = process.env.PORT || 3000;

// Middleware JSON e serve arquivos estáticos da pasta "public"
app.use(express.json());
app.use(express.static(path.resolve('public')));

// Configuração PostgreSQL
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: 5432,
    ssl: { rejectUnauthorized: false },
});

// Configuração Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer para upload de imagens em memória
const upload = multer({ storage: multer.memoryStorage() });

// Função para criar a tabela se não existir
async function criarTabela() {
    const query = `
        CREATE TABLE IF NOT EXISTS produtos (
            id SERIAL PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            descricao TEXT,
            preco NUMERIC NOT NULL,
            imagens JSON NOT NULL,
            categoria VARCHAR(100) NOT NULL,
            loja VARCHAR(100) NOT NULL,
            link TEXT NOT NULL
        );
    `;
    await pool.query(query);
}
criarTabela().catch(console.error);

// Rota para listar produtos com paginação e filtros
app.get('/api/produtos', async (req, res) => {
    try {
        const { page = 1, limit = 12, categoria, loja, busca } = req.query;
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM produtos WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) FROM produtos WHERE 1=1';
        const values = [];
        let paramIndex = 1;

        if (categoria && categoria !== 'todas') {
            query += ` AND categoria = $${paramIndex}`;
            countQuery += ` AND categoria = $${paramIndex}`;
            values.push(categoria);
            paramIndex++;
        }
        if (loja && loja !== 'todas') {
            query += ` AND loja = $${paramIndex}`;
            countQuery += ` AND loja = $${paramIndex}`;
            values.push(loja);
            paramIndex++;
        }
        if (busca) {
            query += ` AND (LOWER(nome) LIKE $${paramIndex} OR LOWER(descricao) LIKE $${paramIndex})`;
            countQuery += ` AND (LOWER(nome) LIKE $${paramIndex} OR LOWER(descricao) LIKE $${paramIndex})`;
            values.push(`%${busca.toLowerCase()}%`);
            paramIndex++;
        }

        query += ` ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;

        console.log('Parâmetros recebidos:', req.query);
        console.log('Consulta SQL:', query, 'Valores:', values);

        const { rows: data } = await pool.query(query, values);
        const { rows: countRows } = await pool.query(countQuery, values);
        const total = parseInt(countRows[0].count);

        res.json({ data, total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao listar produtos' });
    }
});

// Rota para adicionar produto com upload de múltiplas imagens
app.post('/api/produtos', upload.array('imagens', 3), async (req, res) => {
    try {
        const { nome, descricao, preco, categoria, loja, link } = req.body;
        if (!nome || !descricao || !preco || !categoria || !loja || !link) {
            return res.status(400).json({ error: 'Campos obrigatórios faltando' });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'É necessário enviar ao menos uma imagem' });
        }

        const urls = await Promise.all(req.files.map(file => {
            return new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'produtos' },
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result.secure_url);
                    }
                );
                streamifier.createReadStream(file.buffer).pipe(uploadStream);
            });
        }));

        const query = `
            INSERT INTO produtos (nome, descricao, preco, categoria, loja, link, imagens)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
        `;
        const values = [nome, descricao, parseFloat(preco), categoria, loja, link, JSON.stringify(urls)];
        const { rows } = await pool.query(query, values);

        // Emitir evento Socket.IO
        io.emit('novoProduto');

        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao adicionar produto' });
    }
});

// Rota para deletar produto por ID
app.delete('/api/produtos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { rowCount } = await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
        if (rowCount > 0) {
            // Emitir evento Socket.IO
            io.emit('produtoExcluido');
            res.json({ message: 'Produto excluído com sucesso' });
        } else {
            res.status(404).json({ error: 'Produto não encontrado' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao excluir produto' });
    }
});

// Rota para atualizar produto por ID
app.put('/api/produtos/:id', upload.array('imagens', 3), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { nome, descricao, preco, categoria, loja, link } = req.body;
        let urls = JSON.parse(req.body.imagens);

        // Se houver novas imagens, faça o upload
        if (req.files && req.files.length > 0) {
            const newUrls = await Promise.all(req.files.map(file => {
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { folder: 'produtos' },
                        (error, result) => {
                            if (error) return reject(error);
                            resolve(result.secure_url);
                        }
                    );
                    streamifier.createReadStream(file.buffer).pipe(uploadStream);
                });
            }));
            urls = urls.concat(newUrls);
        }

        const query = `
            UPDATE produtos
            SET nome = $1, descricao = $2, preco = $3, categoria = $4, loja = $5, link = $6, imagens = $7
            WHERE id = $8 RETURNING *;
        `;
        const values = [nome, descricao, parseFloat(preco), categoria, loja, link, JSON.stringify(urls), id];
        const { rows } = await pool.query(query, values);

        if (rows.length > 0) {
            // Emitir evento Socket.IO
            io.emit('produtoAtualizado');
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: 'Produto não encontrado' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
});


// Iniciar servidor
server.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
