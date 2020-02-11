const crypto = require('crypto');

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

module.exports = { pbkdf2, pbkdf2Compare };
