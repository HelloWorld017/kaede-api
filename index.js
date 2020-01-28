const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const express = require('express');

const GhostContentAPI = require('@tryghost/content-api');
const { ObjectId, MongoClient } = require('mongodb');

const GHOST_URL = process.env.GHOST_URL || 'http://localhost:2368';
const GHOST_KEY = process.env.GHOST_KEY;

const MONGODB_HOST = process.env.MONGODB_HOST || 'localhost';
const MONGODB_PORT = process.env.MONGODB_PORT || '27017';
const MONGODB_DBNAME = process.env.MONGODB_DBNAME || 'ghost-kaede';
const MONGODB_USERNAME = process.env.MONGODB_USERNAME;
const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD;

const COLL_POSTS = 'posts';
const COLL_COMMENTS = 'comments';

const COMMENTS_MAX_COUNT = parseInt(process.env.COMMENTS_MAX_COUNT) || 10000;
const COMMENTS_MAX_AUTHOR = parseInt(process.env.COMMENTS_MAX_AUTHOR) || 32;
const COMMENTS_MAX_CONTENT = parseInt(process.env.COMMENTS_MAX_CONTENT) || 1500;
const COMMENTS_PER_PAGE = 30;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?
	(
		crypto.createHash('sha256')
			.update(process.env.ADMIN_PASSWORD)
			.digest('hex')
			.toLowerCase()
	) : null;

const PORT = parseInt(process.env.PORT) || 11005;

let counter = 0;
const genId = () => {
	counter = (counter + 1) % 1000;

	return Math.floor(Date.now() / 1000) * 100000 +
		Math.floor(Math.random() * 100) * 1000 +
		counter;
};

const pbkdf2 = async (password, salt) => {
	if(salt === undefined) {
		salt = await new Promise((resolve, reject) => {
			crypto.randomBytes(9, (err, buf) => {
				if(err) return reject(err);
				resolve(buf);
			});
		});
	} else {
		salt = Buffer.from(salt, 'base64');
	}

	const passwordHashed = await new Promise((resolve, reject) => {
		crypto.pbkdf2(
			password.slice(0, 32), // As password is client-side hashed. (sha256)
			salt,
			1e+4,
			36,
			'sha256',
			(err, derivedKey) => {
				if(err) return reject(err);
				resolve(
					`${salt.toString('base64')}:${derivedKey.toString('base64')}`
				);
			}
		);
	});

	return passwordHashed;
};

const pbkdf2Compare = async (passwordSalted, passwordRaw) => {
	if(passwordSalted === '') return false;

	const [salt, passwordHash] = passwordSalted.split(':');
	const passwordTarget = await pbkdf2(passwordRaw, salt);

	return passwordTarget === passwordSalted;
};

class ApiError extends Error {
	constructor(message) {
		super(message);

		this.isApiError = true;
	}
}

(async () => {
	const mongoUrl = MONGODB_USERNAME ?
		`mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}` :
		`mongodb://${MONGODB_HOST}:${MONGODB_PORT}`;

	const mongoClient = await MongoClient.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
	const db = mongoClient.db(MONGODB_DBNAME);

	try {
		await db.collection(COLL_POSTS)
			.createIndex({ postId: 1 });
	} catch(err) {}

	try {
		await db.collection(COLL_COMMENTS)
			.createIndex({ threadId: 1, subThreadId: 1 });
	} catch(err) {}

	const api = new GhostContentAPI({
		url: GHOST_URL,
		key: GHOST_KEY,
		version: 'v3'
	});

	const app = express();
	app.use(bodyParser.json());
	app.use(cors({
		origin: GHOST_URL
	}));

	app.get('/', (req, res) => {
		res.status(418).json({
			ok: true,
			server: 'Kaede API Server',
			kaede: 'A neat Ghost theme'
		});
	});

	app.param('postId', (req, res, next, postId) => {
		if(typeof postId !== 'string' || !/^[a-f0-9]{0,24}$/.test(postId))
			return next(new ApiError("invalid-postid"));

		req.getPost = async (projection = { _id: false }) => {
			const post = await db.collection(COLL_POSTS)
				.findOne({ postId }, { projection });

			if(post) {
				return post;
			}

			const ghostPost = await api.posts.read({id: postId});
			if(!ghostPost || ghostPost.id !== postId)
				throw new ApiError("no-such-post");

			const written = await db.collection(COLL_POSTS).insertOne({
				postId,
				likes: 0
			});

			return written.ops[0];
		};

		next();
	});

	const register = (methodName, route, callback) => {
		app[methodName](route, async (req, res, next) => {
			try {
				await callback(req, res);
			} catch(err) {
				next(err);
			}
		});
	}

	register('get', '/:postId', async (req, res) => {
		const post = await req.getPost();
		res.json({
			ok: true,
			...post
		});
	});

	register('get', '/:postId/likes', async (req, res) => {
		const { likes } = await req.getPost({ _id: false, likes: true });
		res.json({
			ok: true,
			likes
		});
	});

	register('post', '/:postId/likes', async (req, res) => {
		const { _id: ensurePost } = await req.getPost({ _id: true });

		const { value: { likes: newLikes } } = await db.collection(COLL_POSTS).findOneAndUpdate(
			{ _id: ensurePost },
			{ $inc: { likes: 1 } },
			{ returnOriginal: false, projection: { likes: true } }
		);

		res.json({
			ok: true,
			likes: newLikes
		});
	});

	register('get', '/:postId/comments', async (req, res) => {
		let page = 1;
		if(req.query.page) {
			const parsedPage = parseInt(req.query.page);
			if(
				isFinite(parsedPage) &&
				parsedPage > 0 &&
				(
					COMMENTS_MAX_COUNT < 0 ||
					page <= Math.ceil(COMMENTS_MAX_COUNT / COMMENTS_PER_PAGE)
				)
			) {
				page = parsedPage;
			}
		}

		const comments = await db.collection(COLL_COMMENTS).find({
			postId: req.params.postId
		}, { projection: { password: false } });

		const commentsCount = await comments.count();
		const commentsResult = await comments
			.sort({ threadId: 1, subThreadId: 1 })
			.skip((page - 1) * COMMENTS_PER_PAGE)
			.limit(COMMENTS_PER_PAGE)
			.toArray();

		res.json({
			ok: true,
			pagination: {
				current: page,
				max: Math.ceil(commentsCount / COMMENTS_PER_PAGE)
			},
			comments: commentsResult
		});
	});

	register('post', '/:postId/comments', async (req, res) => {
		const { _id: ensurePost } = await req.getPost({ _id: true });

		if(!req.body || typeof req.body !== 'object')
			throw new ApiError("invalid-body");

		const existingComments = await db.collection(COLL_COMMENTS).find({
			postId: req.params.postId
		}, { projection: { _id: true } });

		const commentsCount = await existingComments.count();
		if((commentsCount >= COMMENTS_MAX_COUNT) && (COMMENTS_MAX_COUNT > 0))
			throw new ApiError("too-many-comments");

		const comment = {
			postId: req.params.postId
		};

		if(typeof req.body.replyTo === 'number' || typeof req.body.replyTo === 'string') {
			const replyTo = parseInt(req.body.replyTo);

			if(isFinite(replyTo) && replyTo > 0) {
				const ensureComment = await db.collection(COLL_COMMENTS).find({
					postId: req.params.postId,
					threadId: replyTo
				}, { projection: { _id: true } });

				if(ensureComment) {
					comment.threadId = req.body.replyTo;
					comment.subThreadId = genId();
				}
			}
		}

		if(!comment.threadId) {
			comment.threadId = genId();
			comment.subThreadId = 0;
		}

		if(typeof req.body.content !== 'string')
			throw new ApiError("invalid-content");

		comment.content = req.body.content.slice(0, COMMENTS_MAX_CONTENT);

		if(typeof req.body.author !== 'string')
			throw new ApiError("invalid-author");

		comment.author = req.body.author.slice(0, COMMENTS_MAX_AUTHOR);

		if(typeof req.body.password !== 'string')
			throw new ApiError("invalid-password");

		comment.password = await pbkdf2(req.body.password);
		comment.date = Date.now();

		const inserted = await db.collection(COLL_COMMENTS)
			.insertOne(comment);

		const output = inserted.ops[0];
		delete output.password;

		res.json({
			ok: true,
			comment: output
		});
	});

	register('delete', '/:postId/comments/:commentId', async (req, res) => {
		const deleted = [];
		const commentId = req.params.commentId;
		if(typeof commentId !== 'string' || !/^[a-f0-9]{24}$/.test(commentId))
			throw new ApiError("invalid-commentid");

		const commentObjId = new ObjectId(commentId);
		const comment = await db.collection(COLL_COMMENTS)
			.findOne({ _id: commentObjId }, {
				projection: {
					_id: true, deleted: true, password: true,
					postId: true, threadId: true, subThreadId: true
				}
			});

		if(!comment || comment.deleted)
			throw new ApiError("no-such-comment");

		const password = req.body.password;
		if(typeof password !== 'string')
			throw new ApiError("invalid-password");

		if(!(ADMIN_PASSWORD && password.toLowerCase() === ADMIN_PASSWORD)) {
			const passwordCorrect = await pbkdf2Compare(comment.password, password);

			if(!passwordCorrect)
				throw new ApiError("invalid-password");
		}

		const isReply = comment.subThreadId !== 0;
		const hasAnotherReply = await db.collection(COLL_COMMENTS)
			.findOne({
				postId: comment.postId,
				threadId: comment.threadId,
				subThreadId: { $nin: [ 0, comment.subThreadId ] }
			}, { projection: { _id: true } });

		if(isReply) {
			const parent = await db.collection(COLL_COMMENTS)
				.findOne({
					postId: comment.postId,
					threadId: comment.threadId,
					subThreadId: 0
				}, { projection: { _id: true, deleted: true } });

			if(!hasAnotherReply && parent && parent.deleted) {
				await db.collection(COLL_COMMENTS)
					.deleteOne({
						_id: parent._id
					});

				deleted.push(parent._id.toHexString());
			}
		} else {
			if(hasAnotherReply) {
				await db.collection(COLL_COMMENTS)
					.findOneAndUpdate({
						_id: commentObjId
					}, {
						$set: {
							author: '',
							content: '',
							password: '',
							deleted: true
						}
					});

				res.json({
					ok: true,
					candidates: commentId,
					deleted: []
				});
				return;
			}
		}

		await db.collection(COLL_COMMENTS)
			.deleteOne({
				_id: commentObjId
			});

		deleted.push(commentId);
		res.json({
			ok: true,
			deleted
		});
	});

	app.use((req, res, next) => {
		res.status(404).json({
			ok: false
		});
	});

	app.use((err, req, res, next) => {
		if(err.isApiError) {
			res.status(422).json({
				ok: false,
				reason: err.message
			});
			return;
		}

		res.status(500).json({
			ok: false,
			reason: 'internal-server'
		});
		console.error(err);
	});

	app.listen(PORT);

	console.log(`Listening on ${PORT}`);
})();
