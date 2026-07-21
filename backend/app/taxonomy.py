"""
Stock Taxonomy System

4-level classification hierarchy:
- Level 1: Macro Sector (11 standard sectors)
- Level 2: Industry Cluster (capital-flow aware groupings)
- Level 3: Business Model Group (high signal, comparable peers)
- Level 4: Custom Themes (cross-sector thematic tags)
"""

from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field

# =============================================================================
# Taxonomy Hierarchy Definition
# =============================================================================

TAXONOMY_HIERARCHY: Dict[str, Dict[str, List[str]]] = {
    # Level 1 -> Level 2 -> Level 3
    "Financials": {
        "Banks": [
            "Money Center Banks",
            "Regional Banks",
            "Community Banks",
            "Investment Banks",
        ],
        "Insurance": [
            "P&C Insurers",
            "Life & Health",
            "Reinsurance",
            "Insurance Brokers",
            "Specialty Insurance",
        ],
        "Asset Managers": [
            "Traditional Asset Managers",
            "Alternative Asset Managers",
            "Wealth Management",
            "ETF Providers",
        ],
        "Exchanges & Market Infrastructure": [
            "Stock Exchanges",
            "Derivatives Exchanges",
            "Clearing Houses",
            "Market Data Providers",
        ],
        "Fintech": [
            "Payment Processors",
            "Digital Banks",
            "Lending Platforms",
            "Crypto Infrastructure",
        ],
        "Specialty Finance": [
            "Consumer Finance",
            "Commercial Finance",
            "Mortgage REITs",
            "BDCs",
        ],
    },
    "Technology": {
        "Semiconductors": [
            "Foundries",
            "Fabless Designers",
            "Memory",
            "Equipment",
            "Analog",
            "GPU/AI Accelerators",
        ],
        "Software (Enterprise)": [
            "ERP/CRM",
            "Security Software",
            "Database & Analytics",
            "DevOps & Infrastructure",
            "Vertical SaaS",
        ],
        "Software (Consumer)": [
            "Social Media",
            "Gaming",
            "Productivity",
            "Entertainment",
        ],
        "Hardware": [
            "Consumer Electronics",
            "Networking Equipment",
            "Storage",
            "PC & Peripherals",
        ],
        "IT Services": [
            "Consulting",
            "Outsourcing",
            "System Integrators",
        ],
        "Cybersecurity": [
            "Endpoint Security",
            "Network Security",
            "Identity & Access",
            "Cloud Security",
        ],
    },
    "Healthcare": {
        "Pharma": [
            "Big Pharma",
            "Specialty Pharma",
            "Generic Pharma",
        ],
        "Biotech": [
            "Large Cap Biotech",
            "Clinical Stage",
            "Platform/Tools",
            "Gene Therapy",
        ],
        "Medical Devices": [
            "Diversified Devices",
            "Cardio/Vascular",
            "Orthopedics",
            "Diagnostics",
            "Surgical",
        ],
        "Healthcare Services": [
            "Managed Care",
            "Hospitals",
            "Pharmacy Benefit Managers",
            "Healthcare IT",
        ],
        "Life Sciences Tools": [
            "Lab Equipment",
            "CROs/CMOs",
            "Genomics Tools",
        ],
    },
    "Consumer Discretionary": {
        "Retail": [
            "E-commerce",
            "Department Stores",
            "Specialty Retail",
            "Home Improvement",
            "Discount Stores",
        ],
        "Automotive": [
            "OEMs",
            "EV Pure Play",
            "Auto Parts",
            "Dealerships",
        ],
        "Restaurants & Leisure": [
            "QSR",
            "Casual Dining",
            "Hotels",
            "Cruise Lines",
            "Gaming/Casinos",
        ],
        "Apparel & Luxury": [
            "Athletic Wear",
            "Luxury Goods",
            "Fast Fashion",
            "Footwear",
        ],
        "Travel": [
            "Airlines",
            "Online Travel",
            "Car Rental",
        ],
    },
    "Consumer Staples": {
        "Food & Beverage": [
            "Packaged Foods",
            "Beverages (Non-Alc)",
            "Beverages (Alcoholic)",
            "Snacks & Confectionery",
        ],
        "Household Products": [
            "Home Care",
            "Personal Care",
            "Paper Products",
        ],
        "Food Retail": [
            "Grocery Chains",
            "Warehouse Clubs",
            "Convenience Stores",
        ],
        "Tobacco": [
            "Traditional Tobacco",
            "Reduced Risk Products",
        ],
    },
    "Industrials": {
        "Aerospace & Defense": [
            "Defense Primes",
            "Aerospace Suppliers",
            "Commercial Aerospace",
            "Space",
        ],
        "Machinery": [
            "Construction Equipment",
            "Agricultural Equipment",
            "Industrial Machinery",
        ],
        "Transportation": [
            "Railroads",
            "Trucking",
            "Air Freight",
            "Marine Shipping",
        ],
        "Building Products": [
            "HVAC",
            "Electrical Equipment",
            "Building Materials",
        ],
        "Engineering & Construction": [
            "E&C",
            "Infrastructure Services",
        ],
        "Conglomerates": [
            "Diversified Industrials",
        ],
    },
    "Energy": {
        "Oil & Gas E&P": [
            "Integrated Majors",
            "Independent E&P",
            "Oil Sands",
        ],
        "Oil & Gas Services": [
            "Drilling",
            "Equipment & Services",
            "Offshore",
        ],
        "Midstream": [
            "Pipelines",
            "Gathering & Processing",
            "Storage & Terminals",
        ],
        "Refining & Marketing": [
            "Refiners",
            "Fuel Distributors",
        ],
        "Clean Energy": [
            "Solar",
            "Wind",
            "Hydrogen",
            "Energy Storage",
        ],
    },
    "Materials": {
        "Chemicals": [
            "Diversified Chemicals",
            "Specialty Chemicals",
            "Agricultural Chemicals",
        ],
        "Metals & Mining": [
            "Gold Miners",
            "Copper Miners",
            "Diversified Mining",
            "Steel Producers",
        ],
        "Construction Materials": [
            "Aggregates",
            "Cement",
        ],
        "Packaging": [
            "Paper Packaging",
            "Plastic Packaging",
            "Metal Containers",
        ],
    },
    "Utilities": {
        "Electric Utilities": [
            "Regulated Electric",
            "Merchant Power",
            "Renewables Utilities",
        ],
        "Gas Utilities": [
            "Gas Distribution",
        ],
        "Multi-Utilities": [
            "Diversified Utilities",
        ],
        "Water Utilities": [
            "Water",
        ],
    },
    "Real Estate": {
        "Equity REITs": [
            "Data Centers",
            "Industrial REITs",
            "Retail REITs",
            "Office REITs",
            "Residential REITs",
            "Healthcare REITs",
            "Self-Storage",
            "Specialty REITs",
        ],
        "Real Estate Services": [
            "Brokers",
            "Property Managers",
        ],
        "REITs - Other": [
            "Mortgage REITs",
            "Timber REITs",
        ],
    },
    "Communication Services": {
        "Telecom": [
            "Wireless Carriers",
            "Wireline",
            "Tower Companies",
        ],
        "Media": [
            "Broadcast",
            "Cable Networks",
            "Publishing",
        ],
        "Interactive Media": [
            "Search & Advertising",
            "Social Platforms",
            "Streaming",
        ],
        "Entertainment": [
            "Studios",
            "Live Entertainment",
            "Music",
        ],
    },
}

# =============================================================================
# Custom Themes (Cross-Sector)
# =============================================================================

CUSTOM_THEMES: Dict[str, str] = {
    "ai_infrastructure": "AI Infrastructure - Companies building AI compute, chips, and cloud infrastructure",
    "ai_applications": "AI Applications - Companies deploying AI in products/services",
    "defense": "Defense - Military and government contractors",
    "climate_transition": "Climate Transition - Clean energy, EVs, carbon reduction beneficiaries",
    "glp1_exposure": "GLP-1 Exposure - Obesity drug makers and supply chain",
    "housing_cycle": "Housing Cycle - Homebuilders, building materials, mortgage sensitive",
    "rate_sensitive": "Rate Sensitive - Banks, REITs, and duration-heavy businesses",
    "commodity_levered": "Commodity Levered - Mining, energy, and materials producers",
    "china_exposed": "China Exposed - Significant China revenue or supply chain",
    "reshoring": "Reshoring - US manufacturing and supply chain beneficiaries",
    "digital_payments": "Digital Payments - Payment processors and fintech infrastructure",
    "aging_demographics": "Aging Demographics - Healthcare, retirement, senior housing",
    "cybersecurity": "Cybersecurity - Security software and services",
    "infrastructure_spend": "Infrastructure Spend - Government infrastructure beneficiaries",
    "data_centers": "Data Centers - REITs, builders, and power suppliers for data centers",
}

# =============================================================================
# Default Ticker Mappings (Seed Data)
# =============================================================================

DEFAULT_TICKER_TAXONOMY: Dict[str, Dict] = {
    # Technology
    "AAPL": {
        "macro_sector": "Technology",
        "industry_cluster": "Hardware",
        "business_model_group": "Consumer Electronics",
        "themes": ["ai_applications"],
    },
    "MSFT": {
        "macro_sector": "Technology",
        "industry_cluster": "Software (Enterprise)",
        "business_model_group": "ERP/CRM",
        "themes": ["ai_infrastructure", "ai_applications", "cybersecurity"],
    },
    "GOOGL": {
        "macro_sector": "Communication Services",
        "industry_cluster": "Interactive Media",
        "business_model_group": "Search & Advertising",
        "themes": ["ai_infrastructure", "ai_applications"],
    },
    "AMZN": {
        "macro_sector": "Consumer Discretionary",
        "industry_cluster": "Retail",
        "business_model_group": "E-commerce",
        "themes": ["ai_infrastructure", "data_centers"],
    },
    "META": {
        "macro_sector": "Communication Services",
        "industry_cluster": "Interactive Media",
        "business_model_group": "Social Platforms",
        "themes": ["ai_infrastructure", "ai_applications"],
    },
    "NVDA": {
        "macro_sector": "Technology",
        "industry_cluster": "Semiconductors",
        "business_model_group": "GPU/AI Accelerators",
        "themes": ["ai_infrastructure", "data_centers"],
    },
    # Financials
    "BRK-B": {
        "macro_sector": "Financials",
        "industry_cluster": "Insurance",
        "business_model_group": "P&C Insurers",
        "themes": [],
    },
    "JPM": {
        "macro_sector": "Financials",
        "industry_cluster": "Banks",
        "business_model_group": "Money Center Banks",
        "themes": ["rate_sensitive", "digital_payments"],
    },
    "V": {
        "macro_sector": "Financials",
        "industry_cluster": "Fintech",
        "business_model_group": "Payment Processors",
        "themes": ["digital_payments"],
    },
    "MA": {
        "macro_sector": "Financials",
        "industry_cluster": "Fintech",
        "business_model_group": "Payment Processors",
        "themes": ["digital_payments"],
    },
    # Healthcare
    "JNJ": {
        "macro_sector": "Healthcare",
        "industry_cluster": "Pharma",
        "business_model_group": "Big Pharma",
        "themes": ["aging_demographics"],
    },
    "UNH": {
        "macro_sector": "Healthcare",
        "industry_cluster": "Healthcare Services",
        "business_model_group": "Managed Care",
        "themes": ["aging_demographics"],
    },
    "PFE": {
        "macro_sector": "Healthcare",
        "industry_cluster": "Pharma",
        "business_model_group": "Big Pharma",
        "themes": ["aging_demographics"],
    },
    "ABBV": {
        "macro_sector": "Healthcare",
        "industry_cluster": "Pharma",
        "business_model_group": "Big Pharma",
        "themes": ["aging_demographics"],
    },
    # Consumer Staples
    "KO": {
        "macro_sector": "Consumer Staples",
        "industry_cluster": "Food & Beverage",
        "business_model_group": "Beverages (Non-Alc)",
        "themes": [],
    },
    "PEP": {
        "macro_sector": "Consumer Staples",
        "industry_cluster": "Food & Beverage",
        "business_model_group": "Beverages (Non-Alc)",
        "themes": [],
    },
    "PG": {
        "macro_sector": "Consumer Staples",
        "industry_cluster": "Household Products",
        "business_model_group": "Home Care",
        "themes": [],
    },
    "COST": {
        "macro_sector": "Consumer Staples",
        "industry_cluster": "Food Retail",
        "business_model_group": "Warehouse Clubs",
        "themes": [],
    },
    "WMT": {
        "macro_sector": "Consumer Discretionary",
        "industry_cluster": "Retail",
        "business_model_group": "Discount Stores",
        "themes": [],
    },
    # Industrials
    "CAT": {
        "macro_sector": "Industrials",
        "industry_cluster": "Machinery",
        "business_model_group": "Construction Equipment",
        "themes": ["infrastructure_spend", "housing_cycle", "commodity_levered"],
    },
    "HON": {
        "macro_sector": "Industrials",
        "industry_cluster": "Conglomerates",
        "business_model_group": "Diversified Industrials",
        "themes": ["defense", "infrastructure_spend"],
    },
    "UPS": {
        "macro_sector": "Industrials",
        "industry_cluster": "Transportation",
        "business_model_group": "Air Freight",
        "themes": [],
    },
    # Energy
    "XOM": {
        "macro_sector": "Energy",
        "industry_cluster": "Oil & Gas E&P",
        "business_model_group": "Integrated Majors",
        "themes": ["commodity_levered"],
    },
    "CVX": {
        "macro_sector": "Energy",
        "industry_cluster": "Oil & Gas E&P",
        "business_model_group": "Integrated Majors",
        "themes": ["commodity_levered"],
    },
}


# =============================================================================
# Helper Functions
# =============================================================================

def get_macro_sectors() -> List[str]:
    """Return all macro sectors."""
    return list(TAXONOMY_HIERARCHY.keys())


def get_industry_clusters(macro_sector: Optional[str] = None) -> Dict[str, List[str]]:
    """Return industry clusters, optionally filtered by macro sector."""
    if macro_sector:
        return {macro_sector: list(TAXONOMY_HIERARCHY.get(macro_sector, {}).keys())}
    return {s: list(clusters.keys()) for s, clusters in TAXONOMY_HIERARCHY.items()}


def get_business_model_groups(
    macro_sector: Optional[str] = None,
    industry_cluster: Optional[str] = None,
) -> List[str]:
    """Return business model groups for given sector/cluster."""
    groups = []
    for sector, clusters in TAXONOMY_HIERARCHY.items():
        if macro_sector and sector != macro_sector:
            continue
        for cluster, models in clusters.items():
            if industry_cluster and cluster != industry_cluster:
                continue
            groups.extend(models)
    return groups


def get_themes() -> Dict[str, str]:
    """Return all custom themes with descriptions."""
    return CUSTOM_THEMES


def get_full_taxonomy_tree() -> Dict:
    """Return the complete taxonomy hierarchy."""
    return {
        "macro_sectors": get_macro_sectors(),
        "hierarchy": TAXONOMY_HIERARCHY,
        "themes": CUSTOM_THEMES,
    }


def validate_taxonomy(
    macro_sector: str,
    industry_cluster: str,
    business_model_group: str,
) -> bool:
    """Validate that a taxonomy path is valid."""
    if macro_sector not in TAXONOMY_HIERARCHY:
        return False
    if industry_cluster not in TAXONOMY_HIERARCHY[macro_sector]:
        return False
    if business_model_group not in TAXONOMY_HIERARCHY[macro_sector][industry_cluster]:
        return False
    return True


@dataclass
class TaxonomyMapping:
    """Represents a company's taxonomy classification."""
    ticker: str
    macro_sector: str
    industry_cluster: str
    business_model_group: str
    themes: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict:
        return {
            "ticker": self.ticker,
            "macro_sector": self.macro_sector,
            "industry_cluster": self.industry_cluster,
            "business_model_group": self.business_model_group,
            "themes": self.themes,
        }


def get_default_mapping(ticker: str) -> Optional[TaxonomyMapping]:
    """Get the default taxonomy mapping for a ticker."""
    data = DEFAULT_TICKER_TAXONOMY.get(ticker)
    if not data:
        return None
    return TaxonomyMapping(
        ticker=ticker,
        macro_sector=data["macro_sector"],
        industry_cluster=data["industry_cluster"],
        business_model_group=data["business_model_group"],
        themes=data.get("themes", []),
    )


# =============================================================================
# Vendor Classification Mapping (yfinance/FMP sector/industry -> our taxonomy)
# =============================================================================

# Map vendor sector names to our macro sectors
VENDOR_SECTOR_MAP: Dict[str, str] = {
    # yfinance / Yahoo Finance sector names
    "Technology": "Technology",
    "Financial Services": "Financials",
    "Financials": "Financials",
    "Healthcare": "Healthcare",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Discretionary": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Staples": "Consumer Staples",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "Basic Materials": "Materials",
    "Materials": "Materials",
    "Utilities": "Utilities",
    "Real Estate": "Real Estate",
    "Communication Services": "Communication Services",
    "Telecommunications": "Communication Services",
}

# Map vendor industry names to (industry_cluster, business_model_group)
# This is a fuzzy mapping - we match keywords
VENDOR_INDUSTRY_MAP: Dict[str, tuple] = {
    # Technology
    "Semiconductors": ("Semiconductors", "Fabless Designers"),
    "Semiconductor Equipment": ("Semiconductors", "Equipment"),
    "Semiconductor Memory": ("Semiconductors", "Memory"),
    "Software—Infrastructure": ("Software (Enterprise)", "DevOps & Infrastructure"),
    "Software—Application": ("Software (Enterprise)", "ERP/CRM"),
    "Software - Infrastructure": ("Software (Enterprise)", "DevOps & Infrastructure"),
    "Software - Application": ("Software (Enterprise)", "ERP/CRM"),
    "Information Technology Services": ("IT Services", "Consulting"),
    "Consumer Electronics": ("Hardware", "Consumer Electronics"),
    "Computer Hardware": ("Hardware", "PC & Peripherals"),
    "Communication Equipment": ("Hardware", "Networking Equipment"),
    "Electronic Components": ("Hardware", "Consumer Electronics"),
    # Financials
    "Banks—Diversified": ("Banks", "Money Center Banks"),
    "Banks—Regional": ("Banks", "Regional Banks"),
    "Banks - Diversified": ("Banks", "Money Center Banks"),
    "Banks - Regional": ("Banks", "Regional Banks"),
    "Insurance—Diversified": ("Insurance", "P&C Insurers"),
    "Insurance—Property & Casualty": ("Insurance", "P&C Insurers"),
    "Insurance—Life": ("Insurance", "Life & Health"),
    "Insurance - Diversified": ("Insurance", "P&C Insurers"),
    "Insurance - Property & Casualty": ("Insurance", "P&C Insurers"),
    "Insurance - Life": ("Insurance", "Life & Health"),
    "Insurance Brokers": ("Insurance", "Insurance Brokers"),
    "Reinsurance": ("Insurance", "Reinsurance"),
    "Asset Management": ("Asset Managers", "Traditional Asset Managers"),
    "Capital Markets": ("Exchanges & Market Infrastructure", "Stock Exchanges"),
    "Financial Data & Stock Exchanges": ("Exchanges & Market Infrastructure", "Market Data Providers"),
    "Credit Services": ("Fintech", "Payment Processors"),
    "Financial Conglomerates": ("Specialty Finance", "Consumer Finance"),
    # Healthcare
    "Drug Manufacturers—General": ("Pharma", "Big Pharma"),
    "Drug Manufacturers—Specialty & Generic": ("Pharma", "Specialty Pharma"),
    "Drug Manufacturers - General": ("Pharma", "Big Pharma"),
    "Drug Manufacturers - Specialty & Generic": ("Pharma", "Specialty Pharma"),
    "Biotechnology": ("Biotech", "Large Cap Biotech"),
    "Medical Devices": ("Medical Devices", "Diversified Devices"),
    "Medical Instruments & Supplies": ("Medical Devices", "Diversified Devices"),
    "Healthcare Plans": ("Healthcare Services", "Managed Care"),
    "Health Care Plans": ("Healthcare Services", "Managed Care"),
    "Medical Care Facilities": ("Healthcare Services", "Hospitals"),
    "Diagnostics & Research": ("Life Sciences Tools", "Lab Equipment"),
    # Consumer Discretionary
    "Internet Retail": ("Retail", "E-commerce"),
    "Specialty Retail": ("Retail", "Specialty Retail"),
    "Home Improvement Retail": ("Retail", "Home Improvement"),
    "Discount Stores": ("Retail", "Discount Stores"),
    "Department Stores": ("Retail", "Department Stores"),
    "Auto Manufacturers": ("Automotive", "OEMs"),
    "Auto Parts": ("Automotive", "Auto Parts"),
    "Restaurants": ("Restaurants & Leisure", "QSR"),
    "Lodging": ("Restaurants & Leisure", "Hotels"),
    "Resorts & Casinos": ("Restaurants & Leisure", "Gaming/Casinos"),
    "Apparel Retail": ("Apparel & Luxury", "Fast Fashion"),
    "Apparel Manufacturing": ("Apparel & Luxury", "Athletic Wear"),
    "Footwear & Accessories": ("Apparel & Luxury", "Footwear"),
    "Luxury Goods": ("Apparel & Luxury", "Luxury Goods"),
    "Airlines": ("Travel", "Airlines"),
    "Travel Services": ("Travel", "Online Travel"),
    # Consumer Staples
    "Packaged Foods": ("Food & Beverage", "Packaged Foods"),
    "Beverages—Non-Alcoholic": ("Food & Beverage", "Beverages (Non-Alc)"),
    "Beverages—Brewers": ("Food & Beverage", "Beverages (Alcoholic)"),
    "Beverages - Non-Alcoholic": ("Food & Beverage", "Beverages (Non-Alc)"),
    "Beverages - Brewers": ("Food & Beverage", "Beverages (Alcoholic)"),
    "Confectioners": ("Food & Beverage", "Snacks & Confectionery"),
    "Household & Personal Products": ("Household Products", "Personal Care"),
    "Household Products": ("Household Products", "Home Care"),
    "Grocery Stores": ("Food Retail", "Grocery Chains"),
    "Food Distribution": ("Food Retail", "Grocery Chains"),
    "Tobacco": ("Tobacco", "Traditional Tobacco"),
    # Industrials
    "Aerospace & Defense": ("Aerospace & Defense", "Defense Primes"),
    "Farm & Heavy Construction Machinery": ("Machinery", "Construction Equipment"),
    "Specialty Industrial Machinery": ("Machinery", "Industrial Machinery"),
    "Railroads": ("Transportation", "Railroads"),
    "Trucking": ("Transportation", "Trucking"),
    "Integrated Freight & Logistics": ("Transportation", "Air Freight"),
    "Air Freight & Logistics": ("Transportation", "Air Freight"),
    "Marine Shipping": ("Transportation", "Marine Shipping"),
    "Building Products & Equipment": ("Building Products", "Building Materials"),
    "Electrical Equipment & Parts": ("Building Products", "Electrical Equipment"),
    "Engineering & Construction": ("Engineering & Construction", "E&C"),
    "Conglomerates": ("Conglomerates", "Diversified Industrials"),
    "Industrial Conglomerates": ("Conglomerates", "Diversified Industrials"),
    # Energy
    "Oil & Gas Integrated": ("Oil & Gas E&P", "Integrated Majors"),
    "Oil & Gas E&P": ("Oil & Gas E&P", "Independent E&P"),
    "Oil & Gas Equipment & Services": ("Oil & Gas Services", "Equipment & Services"),
    "Oil & Gas Drilling": ("Oil & Gas Services", "Drilling"),
    "Oil & Gas Midstream": ("Midstream", "Pipelines"),
    "Oil & Gas Refining & Marketing": ("Refining & Marketing", "Refiners"),
    "Solar": ("Clean Energy", "Solar"),
    "Utilities—Renewable": ("Clean Energy", "Wind"),
    # Materials
    "Specialty Chemicals": ("Chemicals", "Specialty Chemicals"),
    "Chemicals": ("Chemicals", "Diversified Chemicals"),
    "Agricultural Inputs": ("Chemicals", "Agricultural Chemicals"),
    "Gold": ("Metals & Mining", "Gold Miners"),
    "Copper": ("Metals & Mining", "Copper Miners"),
    "Other Industrial Metals & Mining": ("Metals & Mining", "Diversified Mining"),
    "Steel": ("Metals & Mining", "Steel Producers"),
    "Building Materials": ("Construction Materials", "Aggregates"),
    "Packaging & Containers": ("Packaging", "Plastic Packaging"),
    # Utilities
    "Utilities—Regulated Electric": ("Electric Utilities", "Regulated Electric"),
    "Utilities—Diversified": ("Multi-Utilities", "Diversified Utilities"),
    "Utilities - Regulated Electric": ("Electric Utilities", "Regulated Electric"),
    "Utilities - Diversified": ("Multi-Utilities", "Diversified Utilities"),
    # Real Estate
    "REIT—Diversified": ("Equity REITs", "Specialty REITs"),
    "REIT—Industrial": ("Equity REITs", "Industrial REITs"),
    "REIT—Retail": ("Equity REITs", "Retail REITs"),
    "REIT—Residential": ("Equity REITs", "Residential REITs"),
    "REIT—Office": ("Equity REITs", "Office REITs"),
    "REIT—Healthcare Facilities": ("Equity REITs", "Healthcare REITs"),
    "REIT—Specialty": ("Equity REITs", "Specialty REITs"),
    "REIT - Diversified": ("Equity REITs", "Specialty REITs"),
    "REIT - Industrial": ("Equity REITs", "Industrial REITs"),
    "Real Estate Services": ("Real Estate Services", "Brokers"),
    # Communication Services
    "Telecom Services": ("Telecom", "Wireless Carriers"),
    "Internet Content & Information": ("Interactive Media", "Search & Advertising"),
    "Electronic Gaming & Multimedia": ("Software (Consumer)", "Gaming"),
    "Entertainment": ("Entertainment", "Studios"),
    "Broadcasting": ("Media", "Broadcast"),
    "Advertising Agencies": ("Interactive Media", "Search & Advertising"),
}


def infer_taxonomy_from_vendor(
    sector: Optional[str],
    industry: Optional[str],
) -> Optional[Dict[str, str]]:
    """
    Infer taxonomy classification from vendor sector/industry data.
    
    Returns dict with macro_sector, industry_cluster, business_model_group
    or None if cannot be inferred.
    """
    if not sector:
        return None
    
    # Map sector
    macro_sector = VENDOR_SECTOR_MAP.get(sector)
    if not macro_sector:
        # Try fuzzy match
        for vendor_sector, our_sector in VENDOR_SECTOR_MAP.items():
            if vendor_sector.lower() in sector.lower() or sector.lower() in vendor_sector.lower():
                macro_sector = our_sector
                break
    
    if not macro_sector:
        return None
    
    # Map industry
    industry_cluster = None
    business_model_group = None
    
    if industry:
        # Try exact match first
        if industry in VENDOR_INDUSTRY_MAP:
            industry_cluster, business_model_group = VENDOR_INDUSTRY_MAP[industry]
        else:
            # Try fuzzy match
            industry_lower = industry.lower()
            for vendor_industry, (cluster, model) in VENDOR_INDUSTRY_MAP.items():
                if vendor_industry.lower() in industry_lower or industry_lower in vendor_industry.lower():
                    industry_cluster = cluster
                    business_model_group = model
                    break
    
    # If no industry match, use first cluster/model for the sector
    if not industry_cluster and macro_sector in TAXONOMY_HIERARCHY:
        first_cluster = list(TAXONOMY_HIERARCHY[macro_sector].keys())[0]
        industry_cluster = first_cluster
        business_model_group = TAXONOMY_HIERARCHY[macro_sector][first_cluster][0]
    
    if not industry_cluster:
        return None
    
    return {
        "macro_sector": macro_sector,
        "industry_cluster": industry_cluster,
        "business_model_group": business_model_group,
    }


# Theme inference rules based on industry/sector keywords
THEME_INFERENCE_RULES: Dict[str, List[str]] = {
    "ai_infrastructure": ["Semiconductor", "Cloud", "Data Center"],
    "defense": ["Defense", "Aerospace", "Military"],
    "climate_transition": ["Solar", "Wind", "Renewable", "Electric Vehicle", "EV"],
    "rate_sensitive": ["Bank", "REIT", "Mortgage"],
    "commodity_levered": ["Oil", "Gas", "Mining", "Steel", "Gold", "Copper"],
    "digital_payments": ["Payment", "Credit Services", "Fintech"],
    "aging_demographics": ["Healthcare", "Pharma", "Biotech", "Medical"],
    "cybersecurity": ["Security", "Cyber"],
    "data_centers": ["Data Center", "Cloud Infrastructure"],
}


def infer_themes_from_industry(industry: Optional[str], sector: Optional[str]) -> List[str]:
    """Infer theme tags from industry/sector keywords."""
    themes = []
    text = f"{sector or ''} {industry or ''}".lower()
    
    for theme, keywords in THEME_INFERENCE_RULES.items():
        for keyword in keywords:
            if keyword.lower() in text:
                themes.append(theme)
                break
    
    return themes
