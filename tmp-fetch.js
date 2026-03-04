const https = require('https');

https.get('https://www.sefaria.org/api/v2/raw/index/Torah_Ohr', (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
        const json = JSON.parse(data);
        const nodes = json.schema.nodes;
        const parashot = nodes.map(n => ({
            en: n.titles.find(t => t.lang === 'en' && t.primary)?.text || n.titles.find(t => t.lang === 'en')?.text,
            he: n.titles.find(t => t.lang === 'he' && t.primary)?.text || n.titles.find(t => t.lang === 'he')?.text,
            depth: n.depth
        }));
        console.log(JSON.stringify(parashot, null, 2));
    });
});
