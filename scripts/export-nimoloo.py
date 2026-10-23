#!/usr/bin/env python3
"""Build a verified and auto-refreshed Excel workbook without paid dependencies."""
import json
import os
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from xml.sax.saxutils import escape

source=Path('public/nimoloo/data/latest.json')
target=Path('public/nimoloo/reports/latest.xlsx')
data=json.loads(source.read_text(encoding='utf-8'))
if data.get('schemaVersion')!=1:raise SystemExit('Refusing unknown data schema')
now=datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
unknown='Not verified'
def total(field):
    channels=data.get('channels',[])
    if not channels or any(type(c.get(field)) not in (int,float) for c in channels):return unknown
    return sum(c[field] for c in channels)
names=['Overview','Channels','Videos','Agents','Alerts','Diagnostics']
tables=[
 [
 ['NIMOLOO CONTROL | VERIFIED REPORT'],
 ['Generated UTC',now],
 ['YouTube last verified UTC',data.get('updatedAt') or unknown],
 ['Data source',data.get('source') or unknown],
 [],
 ['METRIC','VALUE','NOTES'],
 ['Total views',total('totalViews'),'Requires a YouTube API key'],
 ['Subscribers',total('subscribers'),'YouTube may hide these'],
 ['Video count',total('videoCount'),'Stats from public YouTube channel'],
 ['Verified feed rows',len(data.get('videos',[])) if data.get('updatedAt') else unknown,'Up to 50 newest public uploads per channel'],
 [],
 ['Dashboard','https://imedbensalah99-cmd.github.io/APP-AI/nimoloo/'],
 ['Refresh','Automatically attempted every three hours via GitHub Actions'],
 ['Private videos','Public feeds cannot see private videos; authenticate locally on Termux']
 ],
 [['CHANNEL','CHANNEL ID','VIEWS','SUBSCRIBERS','VIDEO COUNT','LAST CHECKED UTC','DATA SOURCE','UPLOAD MODE']]+[
 [c.get('name'),c.get('youtubeId'),c.get('totalViews'),c.get('subscribers'),c.get('videoCount'),c.get('lastCheckedAt'),data.get('source'),c.get('uploadMode')]
 for c in data.get('channels',[])],
 [['CHANNEL','VIDEO ID','TITLE','PUBLISHED UTC','VISIBILITY','VIEWS','LIKES','VIDEO URL']]+[
 [v.get('channelName') or v.get('channel'),v.get('id'),v.get('title'),v.get('publishedAt'),v.get('privacy'),v.get('views'),v.get('likes'),'https://www.youtube.com/watch?v='+v['id'] if v.get('id') else None]
 for v in data.get('videos',[])],
 [['AGENT','STATUS','SCHEDULE','LATEST DIAGNOSTIC']]+[
 [a.get('name'),a.get('status'),a.get('schedule'),a.get('details')]
 for a in data.get('agents',[])],
 [['PRIORITY','ISSUE','RECOMMENDED REPAIR','MONITOR CODE']]+[
 [a.get('severity'),a.get('title'),a.get('detail'),a.get('code')]
 for a in data.get('alerts',[])],
 [['ATTRIBUTE','VALUE'],
 ['Generated UTC',now],
 ['Verified as of',data.get('updatedAt') or unknown],
 ['Data source',data.get('source') or unknown],
 ['Polling frequency','3 hours for scheduled GitHub snapshot; optionally 5 minutes in browser'],
 ['Private video availability','Not visible to the public YouTube API or RSS'],
 ['Privacy','No OAuth credentials or personal login secrets in this workbook'],
 ['Unknown fields','Blank = unknown; never replace with a false zero']]
]
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
OFFICE='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
def safe(v):
    s=''.join(c if ord(c)>=32 or c in '\t\n\r' else ' ' for c in str(v))
    return escape(s, {'"':'&quot;',"'":'&apos;'})
def letter(idx):
    out=''
    while idx:
        idx,rem=divmod(idx-1,26)
        out=chr(65+rem)+out
    return out
def make_sheet(table,overview=False):
    width=max([len(row) for row in table]+[2])
    out=[f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>']
    for i in range(1,width+1):
        w=44 if i in (1,3,4) else 25
        if i==2:w=34
        if i>=7:w=48
        out.append(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>')
    out.append('</cols><sheetData>')
    for r,row in enumerate(table,1):
        if not row:continue
        out.append(f'<row r="{r}" ht="{30 if r==1 else 23}" customHeight="1">')
        for i,value in enumerate(row,1):
            if value is None or value=='':continue
            ref=letter(i)+str(r)
            style=1 if (r==1 or (overview and r==6)) else (2 if r%2 else 0)
            if type(value) in (int,float):
                out.append(f'<c r="{ref}" s="{style}"><v>{value}</v></c>')
            else:
                out.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{safe(value)}</t></is></c>')
        out.append('</row>')
    out.append('</sheetData></worksheet>')
    return ''.join(out)
styles=f'''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{NS}"><fonts count="2"><font><sz val="11"/><name val="Aptos"/><color rgb="FF213044"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF152640"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF5F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
book=f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{NS}" xmlns:r="{OFFICE}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'+''.join(f'<sheet name="{safe(name)}" sheetId="{i}" r:id="rId{i}"/>' for i,name in enumerate(names,1))+'</sheets><calcPr calcMode="auto"/></workbook>'
bookrels=f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}">'+''.join(f'<Relationship Id="rId{i}" Type="{OFFICE}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,len(names)+1))+f'<Relationship Id="rId{len(names)+1}" Type="{OFFICE}/styles" Target="styles.xml"/></Relationships>'
types=f'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,len(names)+1))+'</Types>'
rootrels=f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
target.parent.mkdir(parents=True,exist_ok=True)
tmp=target.with_suffix('.xlsx.tmp')
with zipfile.ZipFile(tmp,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name,content in [
     ('[Content_Types].xml',types),('_rels/.rels',rootrels),
     ('xl/workbook.xml',book),('xl/_rels/workbook.xml.rels',bookrels),
     ('xl/styles.xml',styles)]:
        z.writestr(name,content)
    for idx,table in enumerate(tables,1):
        z.writestr(f'xl/worksheets/sheet{idx}.xml',make_sheet(table,overview=idx==1))
os.replace(tmp,target)
print(f'Created verified Excel snapshot: {target} ({target.stat().st_size} bytes)')
