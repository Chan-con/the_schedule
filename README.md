# スケジュール帳

React で動作するカレンダーアプリを、Supabase と Google OAuth を利用してクラウド同期できるようにしました。Cloudflare Pages にデプロイすることで Web ブラウザから予定を閲覧・編集できます。

## 主な機能

- 📅 予定・タスク管理（終日、時間指定、通知、タスクチェックなど既存機能はそのまま）
- 🔐 Google アカウントによるサインイン（Supabase Auth / Google OAuth）
- ☁️ Supabase PostgreSQL へユーザー毎に予定を保存（Row Level Security 対応）
- 🔁 オフラインでも利用できるようにユーザー毎のローカルキャッシュを保持
- 🌐 Cloudflare Pages での Web 公開

## 必要な環境変数

`.env` をプロジェクトルートに作成し、以下を設定してください（`.env.example` をコピーすると便利です）。

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SUPABASE_REDIRECT_URL=http://localhost:5173/auth/callback
```

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
	- Supabase プロジェクトの URL と anon キー。
- `VITE_SUPABASE_REDIRECT_URL`
	- ローカル開発時の OAuth リダイレクト先。Cloudflare Pages へ公開したら本番 URL（例: `https://<your-pages>.pages.dev/auth/callback`）に変更します。

> ⚠️ `.env` ファイルは `.gitignore` で除外されています。漏洩しないよう注意してください。

## Supabase 設定

1. **認証設定**
	 - Supabase Auth の設定で Google プロバイダーを有効化し、Google Cloud Console の OAuth クライアント ID / シークレットを登録します。
	 - Supabase の「Allowed Redirect URLs」に以下をすべて追加します。
		 - `http://localhost:5173/auth/callback`
		 - Web 公開先（例: `https://<your-pages>.pages.dev/auth/callback`）

2. **データベース**
	 - `schedules` テーブルを作成します。推奨スキーマ（一例）：

		 ```sql
		 create table public.schedules (
			 id uuid primary key default gen_random_uuid(),
			 user_id uuid not null references auth.users(id) on delete cascade,
			 date text not null,
			 time text,
			 name text not null,
			 memo text,
			 all_day boolean not null default false,
			 all_day_order integer not null default 0,
			 notifications jsonb not null default '[]'::jsonb,
			 is_task boolean not null default false,
			 completed boolean not null default false,
			 created_at timestamp with time zone default now(),
			 updated_at timestamp with time zone default now()
		 );
     
		 alter table public.schedules enable row level security;
     
		 create policy "Read own schedules"
			 on public.schedules for select
			 using (auth.uid() = user_id);
     
		 create policy "Modify own schedules"
			 on public.schedules for all
			 using (auth.uid() = user_id)
			 with check (auth.uid() = user_id);
		 ```

	 - 「更新日時」を自動で管理したい場合はトリガーで `updated_at` を更新するなど調整してください。

## Google OAuth クライアント

Google Cloud Console で OAuth クライアントを作成し、以下のリダイレクト URI を登録します。

- `http://localhost:5173/auth/callback`
- Cloudflare Pages の公開 URL（例: `https://<your-pages>.pages.dev/auth/callback`）

取得した「クライアント ID」「クライアント シークレット」は Supabase の Auth 設定にコピーします。

## 開発手順

```bash
npm install
cp .env.example .env # 必要に応じて値を編集

# Web (Vite) 開発サーバー
npm run dev
```

- ブラウザからは `http://localhost:5173` にアクセスすると確認できます。

## ビルド & デプロイ

### Web (Cloudflare Pages)

1. Cloudflare Pages で新しいプロジェクトを作成し、ビルドコマンドを `npm run build`、ビルド出力ディレクトリを `dist` に設定します。
2. Pages の環境変数に `.env` と同じキーを登録します。
3. デプロイ後、該当ドメインを `VITE_SUPABASE_REDIRECT_URL` と Supabase / Google OAuth のリダイレクト先に追加します。

## 既知の注意点

- ESLint の hook 依存関係に関する警告が一部残っています（既存コード由来）。動作には影響しませんが、今後のリファクタリングで整理予定です。
- Supabase のテーブル定義や Row Level Security ポリシーは用途によって調整してください。
- Cloudflare Pages で SPA を動作させる際は、`/_routes.json` や `_redirects` を追加して全リクエストを `index.html` にフォールバックさせると確実です（必要に応じて設定してください）。

## ライセンス

このリポジトリは元々のスケジュールアプリ同様、プロジェクトオーナーの意向に従ってご利用ください。
