import { fetchNewArticlesForJournal } from '../lib/crossref';

async function test() {
    console.log("Fetching articles for ISSN 0883-9026 (JBV)...");
    // JBV ISSN: 0883-9026
    const articles = await fetchNewArticlesForJournal('0883-9026');
    console.log(`Found ${articles.length} articles.`);
    if (articles.length > 0) {
        console.log("First article:", articles[0].title, articles[0].DOI);
    }
}

test();
