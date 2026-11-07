import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHarness,sample,text} from './client-harness.mjs';

const manageSample = {
  ...sample,
  categories: [...sample.categories, {name:'Empty',unread:0,feeds:[]}],
};

function managementHarness(helpers = {}, extra = {}) {
  return createHarness({
    snapshot: manageSample,
    prefs: { mode: 'sources', readMode: 'manual' },
    helpers: { loadSnapshot: async () => ({ok:true, value:manageSample}), ...helpers },
    ...extra,
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function groupOf(h, name) {
  const group = h.find(n => n.props.className === 'dsh-feeds-sourceGroup' && h.find(
    child => child.props.className === 'dsh-feeds-sourceGroupName' && text(child) === name,
    n,
  ).length > 0)[0];
  assert.ok(group, `missing category group ${name}`);
  return group;
}

function buttonIn(h, node, label) {
  const button = h.find(n => n.type === 'button' && text(n) === label, node)[0];
  assert.ok(button, `missing button ${label}`);
  return button;
}

test('add-subscription form submits url, title and category and reports the fetch result', async t => {
  const added = [];
  const h = managementHarness({
    addFeed: async payload => {
      added.push(payload);
      return {ok:true, value:{added:true, fetched:true, itemCount:3, refreshing:false, error:null}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新增订阅');
  assert.ok(h.text().includes('新增订阅'));
  const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
  assert.ok(url);
  url.props.onChange({currentTarget:{value:'https://new.example/feed'}});
  const title = h.find(n => n.type === 'input' && n.props['aria-label'] === '标题')[0];
  title.props.onChange({currentTarget:{value:'New source'}});
  const category = h.find(n => n.type === 'select' && n.props['aria-label'] === '分类')[0];
  category.props.onChange({currentTarget:{value:'News'}});
  await h.flush();
  await h.click('添加');
  await h.flush();
  assert.deepEqual(plain(added[0]), {url:'https://new.example/feed', title:'New source', category:'News'});
  assert.ok(h.text().includes('抓取成功'));
});

test('add-subscription validation rejects an empty or non-http url without a host call', async t => {
  let calls = 0;
  const h = managementHarness({addFeed: async () => { calls += 1; return {ok:true, value:{added:true}}; }});
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新增订阅');
  await h.click('添加');
  assert.ok(h.text().includes('请输入订阅源地址'));
  const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
  url.props.onChange({currentTarget:{value:'ftp://example.com/feed'}});
  await h.flush();
  await h.click('添加');
  assert.ok(h.text().includes('请输入有效的 http(s) 地址'));
  assert.equal(calls, 0);
});

test('a failed add keeps the form open and shows the host error', async t => {
  const h = managementHarness({addFeed: async () => ({ok:false, error:{message:'boom'}})});
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新增订阅');
  const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
  url.props.onChange({currentTarget:{value:'https://new.example/feed'}});
  await h.flush();
  await h.click('添加');
  await h.flush();
  assert.ok(h.text().includes('boom'));
  assert.ok(h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址').length === 1);
});

test('new-category form creates the category and reports success', async t => {
  const calls = [];
  const h = managementHarness({
    manageCategory: async payload => {
      calls.push(payload);
      return {ok:true, value:{created:true, name:payload.name, categories:['Tech','News','Reading']}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新建分类');
  const input = h.find(n => n.type === 'input' && n.props['aria-label'] === '分类名称')[0];
  assert.ok(input);
  input.props.onChange({currentTarget:{value:'Reading'}});
  await h.flush();
  await h.click('创建');
  await h.flush();
  assert.deepEqual(plain(calls[0]), {op:'create', name:'Reading'});
  assert.ok(h.text().includes('已创建分类'));
});

test('category rename is sent to the host and reported', async t => {
  const calls = [];
  const h = managementHarness({
    manageCategory: async payload => {
      calls.push(payload);
      return {ok:true, value:{renamed:true, merged:false, name:payload.newName, moved:1, categories:[]}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const group = groupOf(h, 'Tech');
  buttonIn(h, group, '重命名').props.onClick();
  await h.flush();
  const input = h.find(n => n.type === 'input' && n.props['aria-label'] === '重命名分类')[0];
  assert.ok(input);
  input.props.onChange({currentTarget:{value:'Tech2'}});
  await h.flush();
  buttonIn(h, undefined, '保存').props.onClick();
  await h.flush();
  assert.deepEqual(plain(calls[0]), {op:'rename', name:'Tech', newName:'Tech2'});
  assert.ok(h.text().includes('分类已重命名为'));
});

test('an empty category deletes after inline confirmation', async t => {
  const calls = [];
  const h = managementHarness({
    manageCategory: async payload => {
      calls.push(payload);
      return {ok:true, value:{deleted:true, name:payload.name, moved:0, categories:[]}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const group = groupOf(h, 'Empty');
  assert.ok(text(group).includes('该分类暂无订阅源'));
  buttonIn(h, group, '删除分类').props.onClick();
  await h.flush();
  assert.ok(h.text().includes('此操作不可撤销'));
  buttonIn(h, undefined, '确认删除').props.onClick();
  await h.flush();
  assert.deepEqual(plain(calls[0]), {op:'delete', name:'Empty'});
  assert.ok(h.text().includes('已删除分类'));
});

test('a non-empty category delete moves its feeds to the chosen category', async t => {
  const calls = [];
  const h = managementHarness({
    manageCategory: async payload => {
      calls.push(payload);
      return {ok:true, value:{deleted:true, name:payload.name, moved:1, moveTo:payload.moveTo, categories:[]}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const group = groupOf(h, 'Tech');
  buttonIn(h, group, '删除分类').props.onClick();
  await h.flush();
  const row = h.find(n => n.props.className === 'dsh-feeds-categoryFormRow')[0];
  assert.ok(row);
  const target = h.find(n => n.type === 'select', row)[0];
  target.props.onChange({currentTarget:{value:'News'}});
  await h.flush();
  buttonIn(h, undefined, '确认删除').props.onClick();
  await h.flush();
  assert.deepEqual(plain(calls[0]), {op:'delete', name:'Tech', moveTo:'News'});
});

test('moving a source category calls updateFeed and reports the move', async t => {
  const updates = [];
  const h = managementHarness({
    updateFeed: async payload => {
      updates.push(payload);
      return {ok:true, value:{updated:true, feed:{id:payload.feedId, title:'Alpha source', category:payload.category}}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const row = h.find(n => n.props.className === 'dsh-feeds-sourceRow' && text(n).includes('Alpha source'))[0];
  const select = h.find(n => n.type === 'select', row)[0];
  select.props.onChange({currentTarget:{value:'News'}});
  await h.flush();
  assert.deepEqual(plain(updates[0]), {feedId:'f1', category:'News'});
  assert.ok(h.text().includes('已把「Alpha source」移动到「News」'));
});

test('a new category can be created from the source move select', async t => {
  const updates = [];
  const h = managementHarness({
    updateFeed: async payload => {
      updates.push(payload);
      return {ok:true, value:{updated:true, feed:{id:payload.feedId, title:'Alpha source', category:payload.category}}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const row = h.find(n => n.props.className === 'dsh-feeds-sourceRow' && text(n).includes('Alpha source'))[0];
  const select = h.find(n => n.type === 'select', row)[0];
  select.props.onChange({currentTarget:{value:'__new_category__'}});
  await h.flush();
  const input = h.find(n => n.type === 'input' && n.props['aria-label'] === '新分类名称')[0];
  assert.ok(input);
  input.props.onChange({currentTarget:{value:'Later'}});
  await h.flush();
  buttonIn(h, undefined, '保存').props.onClick();
  await h.flush();
  assert.deepEqual(plain(updates[0]), {feedId:'f1', category:'Later'});
});

test('import sends the path and replace/merge mode and reports the counts', async t => {
  const imports = [];
  const h = managementHarness({
    importOpml: async payload => {
      imports.push(payload);
      return {ok:true, value:{mode:payload.mode, feeds:3, added:2, updated:1, removed:0, categories:[], refreshing:true}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('导入 OPML');
  const path = h.find(n => n.type === 'input' && n.props['aria-label'] === 'OPML 文件路径')[0];
  assert.ok(path);
  path.props.onChange({currentTarget:{value:'/tmp/feedly.opml'}});
  const merge = h.find(n => n.type === 'input' && n.props.value === 'merge')[0];
  assert.ok(merge);
  merge.props.onChange({currentTarget:{value:'merge'}});
  await h.flush();
  await h.click('开始导入');
  await h.flush();
  assert.deepEqual(plain(imports[0]), {path:'/tmp/feedly.opml', mode:'merge'});
  assert.ok(h.text().includes('新增 2 个'));
});

test('import validates an empty path before calling the host', async t => {
  let calls = 0;
  const h = managementHarness({importOpml: async () => { calls += 1; return {ok:true, value:{}}; }});
  t.after(() => h.dispose());
  await h.flush();
  await h.click('导入 OPML');
  const path = h.find(n => n.type === 'input' && n.props['aria-label'] === 'OPML 文件路径')[0];
  path.props.onChange({currentTarget:{value:'  '}});
  await h.flush();
  await h.click('开始导入');
  assert.ok(h.text().includes('请输入 OPML 文件路径'));
  assert.equal(calls, 0);
});

test('registration exposes the sidebar row, main panel and all twelve injected helpers', async () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let captured = null;
  const registrations = [];
  const ReactStub = {createElement: () => null};
  const windowStub = {__ModuleLoader__:{load(definition){captured = definition;}}};
  const translate = key => key;
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    locale: { register() { return () => {}; }, bind() { return translate; } },
    slots: {
      inject(owner, callback) { callback(); return () => {}; },
      register(options) { registrations.push(options); return () => {}; },
    },
    get(name) { assert.equal(name, 'connection'); return undefined; },
  };
  vm.runInNewContext(source, {window:windowStub, console, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, document:undefined});
  assert.ok(captured);
  const plugin = captured.factory(() => ReactStub);
  assert.deepEqual(plain(plugin.inject), ['slots','locale']);
  plugin.apply(ctx);
  const sidebar = registrations.find(entry => entry.name === 'sidebar.panellist');
  const main = registrations.find(entry => entry.name === 'main');
  assert.ok(sidebar, 'sidebar.panellist registration');
  assert.equal(sidebar.id, 'feeds');
  assert.equal(sidebar.order, 20);
  assert.equal(sidebar.label(), 'view.title');
  assert.ok(main, 'main registration');
  assert.equal(main.key, 'feeds');
  const props = main.inject();
  assert.deepEqual(Object.keys(props).sort(), [
    'addFeed','importOpml','loadArticle','loadItems','loadSnapshot','manageCategory',
    'markItems','refreshFeed','refreshFeeds','removeFeed','saveItems','updateFeed',
  ]);
  for (const value of Object.values(props)) assert.equal(typeof value, 'function');
  const results = await Promise.all([
    props.addFeed({url:'https://example.org/feed'}),
    props.updateFeed({feedId:'f1', category:'News'}),
    props.manageCategory({op:'create', name:'Reading'}),
    props.importOpml({path:'/tmp/a.opml', mode:'merge'}),
  ]);
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'feeds/unavailable');
  }
});

test('pressing Enter in the add form submits it', async t => {
  const added = [];
  const h = managementHarness({
    addFeed: async payload => {
      added.push(payload);
      return {ok:true, value:{added:true, fetched:true, itemCount:1, refreshing:false, error:null}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新增订阅');
  const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
  url.props.onChange({currentTarget:{value:'https://enter.example/feed'}});
  await h.flush();
  const form = h.find(n => n.props.className === 'dsh-feeds-formCard')[0];
  form.props.onKeyDown({key:'Enter', target:{tagName:'INPUT'}, preventDefault(){}});
  await h.flush();
  assert.equal(added.length, 1);
  assert.equal(added[0].url, 'https://enter.example/feed');
});

test('the add result distinguishes already-subscribed, fetch failure and background fetching', async t => {
  const cases = [
    {value:{added:false,reason:'already-subscribed',refreshing:false,fetched:false,itemCount:0,error:null}, expect:'已经订阅过'},
    {value:{added:true,fetched:false,itemCount:0,refreshing:false,error:'HTTP 404'}, expect:'首次抓取失败'},
    {value:{added:true,fetched:false,itemCount:0,refreshing:true,error:null}, expect:'后台抓取'},
  ];
  for (const entry of cases) {
    const h = managementHarness({addFeed: async () => ({ok:true, value:entry.value})});
    await h.flush();
    await h.click('新增订阅');
    const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
    url.props.onChange({currentTarget:{value:'https://result.example/feed'}});
    await h.flush();
    await h.click('添加');
    await h.flush();
    assert.ok(h.text().includes(entry.expect), `expected ${entry.expect} in ${h.text().slice(0,300)}`);
    h.dispose();
  }
});

test('a new category can be entered directly in the add form', async t => {
  const added = [];
  const h = managementHarness({
    addFeed: async payload => {
      added.push(payload);
      return {ok:true, value:{added:true, fetched:true, itemCount:2, refreshing:false, error:null}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新增订阅');
  const category = h.find(n => n.type === 'select' && n.props['aria-label'] === '分类')[0];
  category.props.onChange({currentTarget:{value:'__new_category__'}});
  await h.flush();
  const name = h.find(n => n.type === 'input' && n.props['aria-label'] === '新分类名称')[0];
  name.props.onChange({currentTarget:{value:'Reading'}});
  const url = h.find(n => n.type === 'input' && n.props['aria-label'] === '订阅源地址')[0];
  url.props.onChange({currentTarget:{value:'https://newcat.example/feed'}});
  await h.flush();
  await h.click('添加');
  await h.flush();
  assert.deepEqual(plain(added[0]), {url:'https://newcat.example/feed', category:'Reading'});
});

test('a failed source move reverts the row and shows an error notice', async t => {
  const h = managementHarness({updateFeed: async () => ({ok:false, error:{message:'nope'}})});
  t.after(() => h.dispose());
  await h.flush();
  const row = h.find(n => n.props.className === 'dsh-feeds-sourceRow' && text(n).includes('Alpha source'))[0];
  const select = h.find(n => n.type === 'select', row)[0];
  select.props.onChange({currentTarget:{value:'News'}});
  await h.flush();
  assert.ok(h.text().includes('移动订阅源失败'));
  const current = h.find(n => n.props.className === 'dsh-feeds-sourceRow' && text(n).includes('Alpha source'))[0];
  assert.equal(h.find(n => n.type === 'select', current)[0].props.value, 'Tech');
});

test('a failed category rename keeps the inline editor and shows the error', async t => {
  const h = managementHarness({manageCategory: async () => ({ok:false, error:{message:'denied'}})});
  t.after(() => h.dispose());
  await h.flush();
  const group = groupOf(h, 'Tech');
  buttonIn(h, group, '重命名').props.onClick();
  await h.flush();
  const input = h.find(n => n.type === 'input' && n.props['aria-label'] === '重命名分类')[0];
  input.props.onChange({currentTarget:{value:'Tech2'}});
  await h.flush();
  buttonIn(h, undefined, '保存').props.onClick();
  await h.flush();
  assert.ok(h.text().includes('denied'));
  assert.equal(h.find(n => n.type === 'input' && n.props['aria-label'] === '重命名分类').length, 1);
});

test('creating a duplicate category is rejected locally', async t => {
  let calls = 0;
  const h = managementHarness({manageCategory: async () => { calls += 1; return {ok:true, value:{created:true, name:'Tech'}}; }});
  t.after(() => h.dispose());
  await h.flush();
  await h.click('新建分类');
  const input = h.find(n => n.type === 'input' && n.props['aria-label'] === '分类名称')[0];
  input.props.onChange({currentTarget:{value:'Tech'}});
  await h.flush();
  await h.click('创建');
  assert.ok(h.text().includes('该分类已存在'));
  assert.equal(calls, 0);
});

test('a non-empty delete defaults to moving feeds into the uncategorized category', async t => {
  const calls = [];
  const h = managementHarness({
    manageCategory: async payload => {
      calls.push(payload);
      return {ok:true, value:{deleted:true, name:payload.name, moved:1, moveTo:payload.moveTo, categories:[]}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  const group = groupOf(h, 'Tech');
  buttonIn(h, group, '删除分类').props.onClick();
  await h.flush();
  buttonIn(h, undefined, '确认删除').props.onClick();
  await h.flush();
  assert.deepEqual(plain(calls[0]), {op:'delete', name:'Tech', moveTo:'未分类'});
});

test('import defaults to merge and reports host failures', async t => {
  const imports = [];
  const h = managementHarness({
    importOpml: async payload => {
      imports.push(payload);
      return {ok:false, error:{message:'bad opml'}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('导入 OPML');
  const path = h.find(n => n.type === 'input' && n.props['aria-label'] === 'OPML 文件路径')[0];
  path.props.onChange({currentTarget:{value:'/tmp/bad.opml'}});
  await h.flush();
  await h.click('开始导入');
  await h.flush();
  assert.deepEqual(plain(imports[0]), {path:'/tmp/bad.opml', mode:'merge'});
  assert.ok(h.text().includes('bad opml'));
});
test('replace import requires an explicit confirmation', async t => {
  const imports = [];
  const h = managementHarness({
    importOpml: async payload => {
      imports.push(payload);
      return {ok:true, value:{mode:payload.mode,feeds:1,added:1,updated:0,removed:0,categories:[]}};
    },
  });
  t.after(() => h.dispose());
  await h.flush();
  await h.click('导入 OPML');
  const path = h.find(n => n.type === 'input' && n.props['aria-label'] === 'OPML 文件路径')[0];
  path.props.onChange({currentTarget:{value:'/tmp/feed.opml'}});
  const replaceRadio = h.find(n => n.type === 'input' && n.props.value === 'replace')[0];
  replaceRadio.props.onChange({currentTarget:{checked:true}});
  await h.flush();
  await h.click('开始导入');
  await h.flush();
  assert.equal(imports.length,0,'replace must not run before confirmation');
  const confirm = h.find(n => n.type === 'input' && n.props.type === 'checkbox')[0];
  confirm.props.onChange({currentTarget:{checked:true}});
  await h.flush();
  await h.click('开始导入');
  await h.flush();
  assert.deepEqual(plain(imports[0]), {path:'/tmp/feed.opml', mode:'replace'});
});
