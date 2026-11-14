"""OAuth for Gmail and Calendar. Least-privilege scopes: read + draft + label + send-drafts, calendar read-only."""
import os

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",       # read, label, create and send drafts
    "https://www.googleapis.com/auth/calendar.readonly",  # free/busy and today's events only
]


def get_creds(credentials_file="credentials.json", token_file="token.json"):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_file, "w") as f:
            f.write(creds.to_json())
        os.chmod(token_file, 0o600)
    return creds
