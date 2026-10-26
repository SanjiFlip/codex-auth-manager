const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture(){
  const elements=new Map();
  const element=()=>({textContent:'',title:'',style:{},dataset:{},hidden:true,children:[],
    setAttribute(){},focus(){},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]}});
  const query=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)};
  const context=vm.createContext({
    window:{codexAuth:null,UsageStatistics:{remaining:()=>null,summarize:()=>({todayTokens:0,todaySessions:0}),compact:String,resetTime:()=>''},showFiveHour:()=>false,planLabel:()=>''},
    location:{search:''},URLSearchParams,clearTimeout,setTimeout,
    document:{querySelector:query,createElement:element,body:{classList:{toggle(){}}}},
  });
  // Execute the real renderer without its IPC startup and timers.
  const source=fs.readFileSync(require.resolve('../src/ui/meter.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('async function load(){')),context);
  return {
    render(current,ids=['a','b','c']){
      context.snapshot={settings:{},accounts:ids.map(id=>({id,displayName:`Account ${id}`,isActive:id===current})),
        current:current==='unsaved'?{exists:true,email:'unsaved@example.invalid'}:current==='unreadable'?{exists:true,error:'Temporary incomplete credential'}:null};
      vm.runInContext('state=snapshot;render()',context);
    },
    choose(id){vm.runInContext('renderOptions()',context);query('#account-options').children.find(option=>option.dataset.id===id).onclick()},
    get name(){return query('#selected-name').textContent},
    get marker(){return query('#selection-state').textContent},
  };
}

test('temporary unreadable login after current account removal does not create a user choice',()=>{
  const ui=fixture();ui.render('c');assert.equal(ui.name,'Account c');
  ui.render('unreadable',['a','b']);assert.equal(ui.name,'Account a');
  ui.render('unsaved',['a','b']);
  assert.equal(ui.name,'unsaved@example.invalid');assert.equal(ui.marker,'当前账号 · 未保存');
});

test('automatic fallback while signed out follows the next current account',()=>{
  const ui=fixture();ui.render(null);assert.equal(ui.name,'Account a');
  ui.render('b');assert.equal(ui.name,'Account b');assert.equal(ui.marker,'当前账号');
});

test('explicit target survives refresh and an unreadable login until that target becomes current',()=>{
  const ui=fixture();ui.render('b');ui.choose('a');
  ui.render('b');assert.equal(ui.name,'Account a');assert.equal(ui.marker,'待切换');
  ui.render('unreadable');ui.render('unsaved');
  assert.equal(ui.name,'Account a');assert.equal(ui.marker,'待切换');
  ui.render('a');assert.equal(ui.marker,'当前账号');
  ui.render('b');assert.equal(ui.name,'Account b');assert.equal(ui.marker,'当前账号');
});

test('removing an explicitly selected target restores following the current account',()=>{
  const ui=fixture();ui.render('b');ui.choose('a');
  ui.render('b',['b','c']);assert.equal(ui.name,'Account b');assert.equal(ui.marker,'当前账号');
  ui.render('unsaved',['b','c']);assert.equal(ui.name,'unsaved@example.invalid');
});
