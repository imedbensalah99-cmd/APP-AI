// A D1-compatible test harness using REAL SQLite from Node 24's built-in node:sqlite.
// No network, cloud mutation or external packages. For CI only.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const schema=readFileSync(fileURLToPath(new URL('./schema.sql',import.meta.url)),'utf8');
class SqliteD1 {
  constructor(file=':memory:', initialize=true){
    this.sqlite=new DatabaseSync(file);
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    if(initialize)this.sqlite.exec(schema);
  }
  prepare(sql){
    const db=this.sqlite;
    return {bind(...params){
      const st=()=>db.prepare(sql);
      return {
        first:async()=>st().get(...params)||null,
        all:async()=>({results:st().all(...params)}),
        run:async()=>({meta:st().run(...params)})
      };
    }};
  }
  async batch(items){
    const db=this.sqlite;
    db.exec('BEGIN IMMEDIATE');
    const result=[];
    try{
      for(const {sql,params} of items){
        const st=db.prepare(sql);
        if(/\bRETURNING\b/i.test(sql)||/^\s*SELECT\b/i.test(sql))
          result.push({results:st.all(...params)});
        else result.push({results:[],meta:st.run(...params)});
      }
      db.exec('COMMIT');
      return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  close(){this.sqlite.close();}
}
// Allows testing Cloudflare D1 prepare().bind() surface with true SQL and transactions.
function d1(file=':memory:',initialize=true){
  const db=new SqliteD1(file,initialize);
  const real=db.prepare.bind(db);
  db.prepare=(sql)=>({
    bind:(...params)=>{
      const bound=real(sql).bind(...params);
      return {sql,params,...bound};
    }
  });
  return db;
}
export {d1};
