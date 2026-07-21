import requests

def get_sp500_from_wikitable2json_api():
    """
    Fetch S&P 500 tickers using the wikitable2json.vercel.app API.
    Returns a list of tickers (cleaned for yfinance).
    """
    # Wikipedia page for S&P 500 companies
    wiki_page = "List_of_S%26P_500_companies"
    url = f"https://wikitable2json.vercel.app/api/{wiki_page}?table=0"
    headers = {
        "User-Agent": "MyS&P500App (cormacqr@gmail.com)"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()  # This is already a list of dicts

        # The API returns a list of dicts; tickers are in the 'Symbol' key
        tickers = [item["Symbol"].replace('.', '-') for item in data if "Symbol" in item]

        return tickers

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from wikitable2json API: {e}")
        return []
    except Exception as e:
        print(f"Unexpected error: {e}")
        return []

if __name__ == "__main__":
    sp500_tickers = get_sp500_from_wikitable2json_api()
    print(f"Found {len(sp500_tickers)} S&P 500 tickers.")
    # print(sp500_tickers)  # Uncomment to see all tickers