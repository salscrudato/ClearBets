const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/database');

//User schema
const UserSchema = mongoose.Schema({
	name: {
		type: String
	},
	username: {
		type: String,
		required: true
	},
	password: {
		type: String,
		required: true
	},
	credit: {
		type: Number
	},
	currentBalance:{
		type: Number
	}
});

const User = module.exports = mongoose.model('User', UserSchema);

module.exports.getUserById = function(id, callback){
	User.findById(id, callback);
}

module.exports.getUserByUsername = function(username, callback){
	const query = {username: username}
	User.findOne(query, callback);
}

module.exports.updateBalance = function(userId, amount, callback){
	const updatedBalance = {currentBalance: amount};
	User.findByIdAndUpdate(userId, updatedBalance, callback);
}
