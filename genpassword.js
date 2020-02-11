const crypto = require('crypto');
const { pbkdf2 } = require('./src/pbkdf2');
const readline = require('readline');

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

rl.question('Please enter your new admin password: ', async password => {
	password = password.trim();

	const hash = crypto.createHash('sha256').update(password).digest('hex').toLowerCase();
	const finalized = await pbkdf2(hash);

	console.log();
	console.log("Password you have entered:");
	console.log(password);
	console.log();
	console.log("Your password hashed:");
	console.log(finalized);

	rl.close();
});
