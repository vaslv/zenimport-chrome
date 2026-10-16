import {permissionOrigin} from './backend-client.js';
const $ = id => document.getElementById(id);
const rpc = data => chrome.runtime.sendMessage(data);
$('server-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (!await chrome.permissions.request({origins: [permissionOrigin($('url').value)]})) throw Error();
    const result = await rpc({type: 'configure', url: $('url').value, token: $('token').value});
    $('status').textContent = result.ok ? 'Сервер подключён.' : 'Не удалось подключиться к серверу.';
    if (result.ok) $('token').value = '';
  } catch { $('status').textContent = 'Проверьте адрес и разрешение доступа к серверу.'; }
});
const state = await rpc({type: 'status'});
$('settings').open = !state.configured;
