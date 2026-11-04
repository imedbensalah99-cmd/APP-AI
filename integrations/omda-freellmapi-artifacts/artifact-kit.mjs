/** No-network CSV export for OMDA. Safe for Excel, no credentials or publishing. */
const MAX_ROWS=1000,MAX_COLS=30,MAX_CELL=2000;
const DANGEROUS=/^[\s\uFEFF]*[=+@\-\t\r]/u;
export function buildCsv({columns,rows,filename='omda-export.csv'}={}) {
 if(!Array.isArray(columns)||columns.length<1||columns.length>MAX_COLS||!columns.every(c=>typeof c==='string'&&c.trim()&&c.length<=100))throw new TypeError('invalid columns');
 if(new Set(columns).size!==columns.length)throw new TypeError('duplicate columns');
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw new TypeError('invalid rows');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.csv$/.test(filename)||filename.includes('..'))throw new TypeError('invalid filename');
 const safe=value=>{
  if(value===null||value===undefined)value='';
  if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new TypeError('invalid cell');
  let s=String(value);if(s.length>MAX_CELL)throw new RangeError('cell too long');
  if(DANGEROUS.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
 };
 const lines=[columns.map(safe).join(',')];
 for(const row of rows){if(!Array.isArray(row)||row.length!==columns.length)throw new TypeError('invalid row');lines.push(row.map(safe).join(','));}
 return {filename,mimeType:'text/csv; charset=utf-8',content:'\uFEFF'+lines.join('\r\n')+'\r\n',rowCount:rows.length,columnCount:columns.length};
}
export function buildJobTrackerCsv(jobs=[]){
 if(!Array.isArray(jobs))throw new TypeError('invalid jobs');
 const columns=['Company','Role','Location','Official URL','Status','Checked Date','Notes'];
 const rows=jobs.map(j=>{
  if(!j||typeof j!=='object'||Array.isArray(j))throw new TypeError('invalid job');
  if(j.url!==undefined&&j.url!==''&&(!/^https:\/\/[^\s]+$/i.test(j.url)||j.url.length>1500))throw new TypeError('invalid URL');
  return [j.company??'',j.role??'',j.location??'',j.url??'',j.status??'Research',j.checkedDate??'',j.notes??''];
 });
 return buildCsv({columns,rows,filename:'omda-job-tracker.csv'});
}