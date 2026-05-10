import { hexToBin } from '@bitauth/libauth';
import { Network } from '../../src/interfaces.js';

const radiantjs = require('@radiantblockchain/radiantjs');

export const network = Network.MAINNET;

export const alice: any = new radiantjs.PrivateKey(Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'));
export const bob: any = new radiantjs.PrivateKey(Buffer.from('0000000000000000000000000000000000000000000000000000000000000002', 'hex'));

export const alicePk = hexToBin('0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8');
export const bobPk = hexToBin('04c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee51ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52a');

export const alicePkh = hexToBin('91b24bf9f5288532960ac687abb035127b1d28a5');
export const bobPkh = hexToBin('d6c8e828c1eca1bba065e1b83e1dc2a36e387a42');

export const oracle: any = { keypair: bob };
export const oraclePk = bobPk;

export const aliceAddress = 'bitcoincash:qzks0nkga5lde0lyds5a4p2r0ufhpaklnvkxhrayr4';
export const bobAddress = 'bitcoincash:qr6mqrklrcfsmreyw0y7h8xzktgny5fmkv5gjhkk2x';
