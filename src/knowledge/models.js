const fs = require('node:fs/promises');
const path = require('node:path');
const TOML = require('@iarna/toml');

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const EFFORT_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

// Return only picker metadata, never cache identity, model prompts or user config.
function normalizeModels(cache) {
  if (!Array.isArray(cache?.models)) throw Error('本地模型目录格式无效，请在 Codex 中更新模型列表后重新读取。');
  const seen = new Set();
  return cache.models.slice(0, 200).filter(m => {
    if (!m || m.visibility !== 'list' || typeof m.slug !== 'string' || !MODEL_ID.test(m.slug || '') || seen.has(m.slug)) return false;
    seen.add(m.slug); return true;
  }).sort((a, b) => (Number.isFinite(a.priority) ? a.priority : 999) - (Number.isFinite(b.priority) ? b.priority : 999)).map(m => {
    const efforts = [], ids = new Set();
    for (const item of (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : []).slice(0, 20)) {
      if (typeof item?.effort !== 'string' || !EFFORT_ID.test(item.effort) || ids.has(item.effort)) continue;
      ids.add(item.effort); efforts.push({ effort: item.effort, description: text(item.description, 240) });
    }
    return {
      id: m.slug, name: text(m.display_name, 120) || m.slug, description: text(m.description, 400),
      efforts, defaultEffort: ids.has(m.default_reasoning_level) ? m.default_reasoning_level : efforts[0]?.effort || '',
    };
  });
}

async function readModelCatalog(home) {
  let cache;
  try {
    const file = path.join(home, 'models_cache.json');
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw Error('oversize');
    cache = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('尚无本地模型目录。请先打开本机 Codex 加载模型列表，再点击「重新读取」。');
    throw Error('无法读取本地模型目录。请在 Codex 中更新模型列表后重新读取。');
  }
  const models = normalizeModels(cache);
  if (!models.length) throw Error('本地目录中没有可选择的模型。请在 Codex 中更新模型列表后重新读取。');
  let config = {}, warning = '';
  try {
    const file = path.join(home, 'config.toml');
    if ((await fs.stat(file)).size > 1024 * 1024) throw Error('oversize');
    const parsed = TOML.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (!parsed.model_provider || parsed.model_provider === 'openai') config = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') warning = '未能读取本机默认偏好，已采用模型目录默认值。';
  }
  const chosen = models.find(m => m.id === config.model) || models[0];
  const effort = chosen.id === config.model && chosen.efforts.some(e => e.effort === config.model_reasoning_effort)
    ? config.model_reasoning_effort : chosen.defaultEffort;
  return {
    models, defaultModel: chosen.id, defaultReasoningEffort: effort, source: 'local-cache',
    fetchedAt: typeof cache.fetched_at === 'string' && Number.isFinite(Date.parse(cache.fetched_at)) ? new Date(cache.fetched_at).toISOString() : null,
    warning,
  };
}

async function resolveModelSelection(home, request) {
  if (request.model !== undefined && (typeof request.model !== 'string' || (request.model && !MODEL_ID.test(request.model)))) throw Error('模型名称格式无效。');
  if (request.reasoningEffort !== undefined && (typeof request.reasoningEffort !== 'string' || (request.reasoningEffort && !EFFORT_ID.test(request.reasoningEffort)))) throw Error('推理强度格式无效。');
  const catalog = await readModelCatalog(home);
  const model = catalog.models.find(m => m.id === (request.model || catalog.defaultModel));
  if (!model) throw Error('所选模型已不在本地可用目录，请重新读取模型后再试。');
  const effort = request.reasoningEffort || (model.id === catalog.defaultModel ? catalog.defaultReasoningEffort : model.defaultEffort);
  if (effort && !model.efforts.some(e => e.effort === effort)) throw Error('所选模型不支持该推理强度，请重新选择。');
  return { model: model.id, reasoningEffort: effort };
}

module.exports = { readModelCatalog, resolveModelSelection, normalizeModels, MODEL_ID, EFFORT_ID };
