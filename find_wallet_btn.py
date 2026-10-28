from pathlib import Path
import re

html_files = ['account.html', 'discover.html', 'index.html', 'listing.html', 'listings.html', 'login.html', 'swap.html', 'token.html', 'trade.html']
for html_file in html_files:
    content = Path(html_file).read_text(encoding='utf-8')
    match = re.search(r'(<button[^>]*data-wallet-connect[^>]*>.*?</button>)', content, re.DOTALL)
    if match:
        print(f'{html_file}: wallet button found')
    else:
        print(f'{html_file}: NO wallet button found')