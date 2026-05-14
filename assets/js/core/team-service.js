import { database } from './firebase.js';

export async function getTeamDataByUID(uid) {
  const s = await database.ref('teams').orderByChild('uid').equalTo(uid).once('value');
  return s.exists() ? { key: Object.keys(s.val())[0], data: Object.values(s.val())[0], type: 'team' } : null;
}

export async function getUserDataByUID(uid) {
  const s = await database.ref('users').orderByChild('uid').equalTo(uid).once('value');
  return s.exists() ? { key: Object.keys(s.val())[0], data: Object.values(s.val())[0], type: 'user' } : null;
}

export async function getAccountByUID(uid) {
  return await getTeamDataByUID(uid) || await getUserDataByUID(uid);
}

export async function getTeamDataByUsername(username) {
  const s = await database.ref('teams').orderByChild('username').equalTo(username).once('value');
  return s.exists() ? { key: Object.keys(s.val())[0], data: Object.values(s.val())[0], type: 'team' } : null;
}

export async function getUserDataByUsername(username) {
  const s = await database.ref('users').orderByChild('username').equalTo(username).once('value');
  return s.exists() ? { key: Object.keys(s.val())[0], data: Object.values(s.val())[0], type: 'user' } : null;
}

export async function getAccountByUsername(username) {
  return await getTeamDataByUsername(username) || await getUserDataByUsername(username);
}

export function makeDefaultStats() {
  return { ch1: 0, ch2: 0, ch3: 0, paidCh1: 0, paidCh2: 0, paidCh3: 0, brawlCh1: 0, brawlCh2: 0, brawlCh3: 0 };
}
