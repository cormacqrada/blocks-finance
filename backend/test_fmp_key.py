#!/usr/bin/env python3
"""Quick test script to verify FMP API key works."""

import os
import sys
import httpx

FMP_API_KEY = os.getenv("FMP_API_KEY")
if not FMP_API_KEY:
    print("ERROR: FMP_API_KEY environment variable is not set")
    print("Set it with: export FMP_API_KEY=your_key_here")
    sys.exit(1)

# Test with a simple profile endpoint
test_ticker = "AAPL"
url = f"https://financialmodelingprep.com/api/v3/profile/{test_ticker}"

print(f"Testing FMP API key with ticker: {test_ticker}")
print(f"URL: {url}")

try:
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, params={"apikey": FMP_API_KEY})
        resp.raise_for_status()
        data = resp.json()
        
        if not data:
            print("ERROR: Empty response from FMP API")
            sys.exit(1)
        
        print("\n✅ SUCCESS! API key is working")
        print(f"\nSample data for {test_ticker}:")
        row = data[0]
        print(f"  Company: {row.get('companyName', 'N/A')}")
        print(f"  Symbol: {row.get('symbol', 'N/A')}")
        print(f"  Exchange: {row.get('exchangeShortName', 'N/A')}")
        print(f"  Market Cap: {row.get('mktCap', 'N/A')}")
        print(f"  Enterprise Value: {row.get('enterpriseValue', 'N/A')}")
        print(f"  EBITDA: {row.get('ebitda', 'N/A')}")
        print(f"  Working Capital: {row.get('workingCapital', 'N/A')}")
        
except httpx.HTTPStatusError as e:
    print(f"\n❌ ERROR: HTTP {e.response.status_code}")
    print(f"Response: {e.response.text}")
    if e.response.status_code == 401:
        print("This usually means the API key is invalid or expired.")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ ERROR: {type(e).__name__}: {e}")
    sys.exit(1)



