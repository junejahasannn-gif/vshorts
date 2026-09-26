name: ViralTap Music Mixer

on:
  workflow_dispatch:
    inputs:
      jobId:
        description: "Unique music remix job ID"
        required: true
        type: string

      sourceJobId:
        description: "Original render job ID"
        required: true
        type: string

      sourceVideoUrl:
        description: "Signed URL of the original rendered MP4"
        required: true
        type: string

      musicUrl:
        description: "Signed URL of the selected music"
        required: true
        type: string

      duration:
        description: "Original video duration"
        required: true
        type: choice
        options:
          - "30"
          - "60"
          - "180"

      musicStyle:
        description: "Selected music style"
        required: true
        type: string

run-name: "Music Mix - ${{ inputs.jobId }}"

permissions:
  contents: read
  id-token: write

jobs:
  remix:
    name: Apply Music To Video
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      # FIX: same bug as render.yml originally had. `cache: npm` requires
      # a lockfile at Setup-Node time, BEFORE the "if package-lock.json
      # exists" check below ever runs — so this failed with "Dependencies
      # lock file is not found" whenever there's no committed lockfile.
      # Disabling the built-in cache here (and doing the ci/install
      # branch manually below) fixes it, matching render.yml.
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          package-manager-cache: false

      - name: Install FFmpeg
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y -qq --no-install-recommends ffmpeg

      - name: Install project dependencies
        run: |
          if [ -f package-lock.json ]; then
            npm ci --no-audit --no-fund
          else
            npm install --no-audit --no-fund
          fi

      - name: Apply selected music
        env:
          JOB_ID: ${{ inputs.jobId }}
          SOURCE_JOB_ID: ${{ inputs.sourceJobId }}
          SOURCE_VIDEO_URL: ${{ inputs.sourceVideoUrl }}
          MUSIC_URL: ${{ inputs.musicUrl }}
          VIDEO_DURATION: ${{ inputs.duration }}
          MUSIC_STYLE: ${{ inputs.musicStyle }}
          VIRALTAP_WORKER_URL: https://vshorts-app.vercel.app/api/render-worker
        run: |
          node scripts/apply-music-runner.mjs
